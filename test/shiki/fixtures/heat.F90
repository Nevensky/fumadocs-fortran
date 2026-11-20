!> Explicit finite differences for the heat equation on a distributed 2-D grid.
!!
!! The grid is split in slabs along y; each rank keeps one halo row above and below its slab.
module heat_solver
#ifdef USE_MPI
  use mpi_f08, only: MPI_Comm, MPI_COMM_WORLD, MPI_DOUBLE_PRECISION, MPI_SUM, &
                     mpi_allreduce, mpi_sendrecv, mpi_comm_rank, mpi_comm_size
#endif
  use, intrinsic :: iso_fortran_env, only: dp => real64, int64, output_unit
  !$ use omp_lib, only: omp_get_max_threads
  implicit none
  private

  public :: grid_t, heat_init, heat_step, heat_norm, heat_run

  integer, parameter :: halo = 1   !< width of the halo, in cells
  real(dp), parameter :: pi = 4.0_dp * atan(1.0_dp)

  !> A slab of the global grid, with its halo rows.
  type :: grid_t
    integer :: nx = 0          !< cells along x
    integer :: ny = 0          !< cells along y on this rank
    integer :: y0 = 0          !< global index of the first row
    real(dp) :: dx = 1.0_dp    !< spacing
    real(dp) :: alpha = 1.0_dp !< diffusivity
    real(dp), allocatable :: u(:,:)   !< temperature, (0:nx+1, 0:ny+1)
    real(dp), allocatable :: tmp(:,:) !< work array of the same shape
#ifdef USE_MPI
    type(MPI_Comm) :: comm
    integer :: rank = 0, size = 1
#endif
  contains
    procedure :: cells => grid_cells
    final :: grid_free
  end type grid_t

  interface heat_init
    module procedure heat_init_uniform
    module procedure heat_init_function
  end interface heat_init

  abstract interface
    !> An initial temperature field.
    pure real(dp) function field(x, y)
      import :: dp
      real(dp), intent(in) :: x, y
    end function field
  end interface

contains

  !> The number of cells this rank owns.
  pure integer(int64) function grid_cells(self) result(n)
    class(grid_t), intent(in) :: self
    n = int(self%nx, int64) * int(self%ny, int64)
  end function grid_cells

  subroutine grid_free(self)
    type(grid_t), intent(inout) :: self
    if (allocated(self%u)) deallocate(self%u)
    if (allocated(self%tmp)) deallocate(self%tmp)
  end subroutine grid_free

  !> Sets up the slab of this rank with a uniform temperature.
  subroutine heat_init_uniform(g, nx, ny, value)
    type(grid_t), intent(out) :: g
    integer, intent(in) :: nx, ny          !! global grid size
    real(dp), intent(in), optional :: value !! initial temperature (default 0)
    integer :: rows, extra
    g%nx = nx
#ifdef USE_MPI
    g%comm = MPI_COMM_WORLD
    call mpi_comm_rank(g%comm, g%rank)
    call mpi_comm_size(g%comm, g%size)
    rows = ny / g%size
    extra = mod(ny, g%size)
    g%ny = rows + merge(1, 0, g%rank < extra)
    g%y0 = g%rank * rows + min(g%rank, extra)
#else
    rows = ny
    extra = 0
    g%ny = ny
    g%y0 = 0
#endif
    g%dx = 1.0_dp / real(nx + 1, dp)
    allocate(g%u(0:g%nx+1, 0:g%ny+1), g%tmp(0:g%nx+1, 0:g%ny+1))
    g%u = 0.0_dp
    if (present(value)) g%u(1:g%nx, 1:g%ny) = value
    g%tmp = g%u
  end subroutine heat_init_uniform

  !> Sets up the slab of this rank from a function of position.
  subroutine heat_init_function(g, nx, ny, f)
    type(grid_t), intent(out) :: g
    integer, intent(in) :: nx, ny
    procedure(field) :: f
    integer :: i, j
    call heat_init_uniform(g, nx, ny)
    !$omp parallel do collapse(2) default(none) shared(g) private(i, j)
    do j = 1, g%ny
      do i = 1, g%nx
        g%u(i, j) = f(i * g%dx, (g%y0 + j) * g%dx)
      end do
    end do
    !$omp end parallel do
    g%tmp = g%u
  end subroutine heat_init_function

  !> Swaps halo rows with the neighbouring ranks.
  subroutine exchange_halo(g)
    type(grid_t), intent(inout) :: g
#ifdef USE_MPI
    integer :: up, down
    up = merge(g%rank + 1, -2, g%rank + 1 < g%size)
    down = merge(g%rank - 1, -2, g%rank > 0)
    if (up >= 0) call mpi_sendrecv(g%u(:, g%ny), g%nx + 2, MPI_DOUBLE_PRECISION, up, 1, &
                                   g%u(:, g%ny + 1), g%nx + 2, MPI_DOUBLE_PRECISION, up, 2, g%comm)
    if (down >= 0) call mpi_sendrecv(g%u(:, 1), g%nx + 2, MPI_DOUBLE_PRECISION, down, 2, &
                                     g%u(:, 0), g%nx + 2, MPI_DOUBLE_PRECISION, down, 1, g%comm)
#else
    g%u(:, 0) = g%u(:, 1)
    g%u(:, g%ny + 1) = g%u(:, g%ny)
#endif
  end subroutine exchange_halo

  !> One explicit Euler step of length dt; returns the largest change.
  function heat_step(g, dt) result(change)
    type(grid_t), intent(inout) :: g
    real(dp), intent(in) :: dt
    real(dp) :: change, r
    integer :: i, j
    r = g%alpha * dt / g%dx**2
    if (r > 0.25_dp) error stop 'heat_step: dt is too large for stability'
    call exchange_halo(g)
    change = 0.0_dp
    !$omp parallel do default(none) shared(g, r) private(i, j) reduction(max: change)
    do j = 1, g%ny
      do i = 1, g%nx
        g%tmp(i, j) = g%u(i, j) + r * (g%u(i+1, j) + g%u(i-1, j) + g%u(i, j+1) + g%u(i, j-1) - 4 * g%u(i, j))
        change = max(change, abs(g%tmp(i, j) - g%u(i, j)))
      end do
    end do
    !$omp end parallel do
    call move_alloc(g%tmp, g%u)
    allocate(g%tmp, mold=g%u)
  end function heat_step

  !> The L2 norm of the temperature over the whole grid.
  real(dp) function heat_norm(g) result(norm)
    type(grid_t), intent(in) :: g
    real(dp) :: local
    local = sum(g%u(1:g%nx, 1:g%ny)**2)
#ifdef USE_MPI
    call mpi_allreduce(local, norm, 1, MPI_DOUBLE_PRECISION, MPI_SUM, g%comm)
#else
    norm = local
#endif
    norm = sqrt(norm * g%dx**2)
  end function heat_norm

  !> Runs steps until the largest change is below tol, and reports progress.
  subroutine heat_run(g, dt, tol, max_steps, verbose)
    type(grid_t), intent(inout) :: g
    real(dp), intent(in) :: dt, tol
    integer, intent(in) :: max_steps
    logical, intent(in), optional :: verbose
    character(len=*), parameter :: fmt = '(a, i8, a, es12.4, a, es12.4)'
    real(dp) :: change
    integer :: step
    logical :: talk
    talk = .false.
    if (present(verbose)) talk = verbose
    !$ if (talk) write (output_unit, '(a, i0, a)') 'using ', omp_get_max_threads(), ' threads'
    do step = 1, max_steps
      change = heat_step(g, dt)
      select case (mod(step, 100))
      case (0)
        if (talk) write (output_unit, fmt) 'step ', step, ': change ', change, ', norm ', heat_norm(g)
      case default
        continue
      end select
      if (change < tol) exit
    end do
    if (step > max_steps) then
      write (output_unit, '(a)') 'heat_run: no convergence'
    else if (talk) then
      write (output_unit, '(a, i0, a)') 'converged after ', step, ' steps'
    end if
  end subroutine heat_run

  !> A smooth initial field, sin(pi x) sin(pi y).
  pure real(dp) function bump(x, y)
    real(dp), intent(in) :: x, y
    bump = sin(pi * x) * sin(pi * y)
  end function bump

end module heat_solver
