!> Linear-algebra kernels for a toy solver.
!> Predoc comment (FORD `!>`) attached to the module below.
module solver_kernels
  !! FORD docmark: the module's own description, with math \( A x = b \).
  !!
  !! @note
  !! A FORD note environment.
  !! @endnote
  !!
  !! See [[dense_matrix]] and [[solve_dense]].
  use, intrinsic :: iso_fortran_env, only: dp => real64, int64
  use, intrinsic :: iso_c_binding, only: c_double, c_int
#ifdef _OPENMP
  use omp_lib, only: omp_get_max_threads
#endif
#ifdef USE_MPI
  use mpi_f08, only: MPI_Comm, MPI_Allreduce, MPI_SUM, MPI_DOUBLE_PRECISION
#endif
  implicit none
  private

  public :: dense_matrix, banded_matrix, solve_dense, norm2_parallel
  public :: operator(+), assignment(=), matrix_free
  public :: color, RED, GREEN

  integer, parameter, public :: max_order = 64 !! largest supported order

  enum, bind(c)
    enumerator :: RED = 1, GREEN
  end enum

  type :: color
    integer :: rgb(3) = 0 !! red, green and blue channels
  end type color

  !> An abstract matrix type.
  type, abstract, public :: abstract_matrix
    integer :: n = 0 !! order of the matrix
  contains
    procedure(matvec_iface), deferred, pass(self) :: matvec !! y = A x
    procedure :: order => matrix_order
    generic :: write(formatted) => write_matrix
    procedure, private :: write_matrix
  end type abstract_matrix

  abstract interface
    !> Matrix-vector product interface.
    subroutine matvec_iface(self, x, y)
      import :: abstract_matrix, dp
      class(abstract_matrix), intent(in) :: self
      real(dp), intent(in)  :: x(:)  !! input vector
      real(dp), intent(out) :: y(:)  !! output vector
    end subroutine matvec_iface
  end interface

  !> Dense, column-major matrix.
  type, extends(abstract_matrix) :: dense_matrix
    real(dp), allocatable :: a(:,:) !! the entries
#ifdef USE_MPI
    type(MPI_Comm) :: comm !! communicator the matrix is distributed over
#endif
  contains
    procedure, pass(self) :: matvec => dense_matvec
    final :: dense_finalize
  end type dense_matrix

  !> A parameterised derived type: banded storage.
  type, extends(abstract_matrix) :: banded_matrix(k, kl, ku)
    integer, kind :: k = dp      !! real kind
    integer, len  :: kl = 1      !! sub-diagonals
    integer, len  :: ku = 1      !! super-diagonals
    real(k) :: ab(kl+ku+1, 100)  !! band storage, LAPACK layout
  contains
    procedure, pass(self) :: matvec => banded_matvec
  end type banded_matrix

  interface operator(+)
    !! Add two dense matrices.
    module procedure add_dense
  end interface

  interface assignment(=)
    module procedure assign_from_array
  end interface

  !> Generic interface with module procedures implemented in a submodule.
  interface solve_dense
    module subroutine solve_dense_real(a, b, info)
      !! Solve \( A X = B \) with LAPACK `dgesv`.
      real(dp), intent(inout) :: a(:,:)        !! on exit, the LU factors
      real(dp), intent(inout) :: b(:,:)        !! right-hand sides; on exit, the solution
      integer,  intent(out), optional :: info  !! LAPACK info code
    end subroutine solve_dense_real
    module subroutine solve_dense_complex(a, b, info)
      !! Complex version, calls `zgesv`.
      complex(dp), intent(inout) :: a(:,:)
      complex(dp), intent(inout) :: b(:,:)
      integer,     intent(out), optional :: info
    end subroutine solve_dense_complex
  end interface solve_dense

  interface
    !> An external C routine.
    function matrix_free(n, x) result(r) bind(c, name="matrix_free_c")
      import :: c_int, c_double
      integer(c_int), value, intent(in) :: n
      real(c_double), intent(in) :: x(n)
      real(c_double) :: r
    end function matrix_free
  end interface

contains

  !> Order of a matrix.
  pure integer function matrix_order(self) result(n)
    class(abstract_matrix), intent(in) :: self
    n = self%n
  end function matrix_order

  subroutine write_matrix(self, unit, iotype, v_list, iostat, iomsg)
    class(abstract_matrix), intent(in) :: self
    integer, intent(in) :: unit
    character(*), intent(in) :: iotype
    integer, intent(in) :: v_list(:)
    integer, intent(out) :: iostat
    character(*), intent(inout) :: iomsg
    write(unit, '(a,i0)', iostat=iostat, iomsg=iomsg) 'matrix of order ', self%n
  end subroutine write_matrix

  subroutine dense_matvec(self, x, y)
    !! Dense product with BLAS `dgemv`, threaded with OpenMP when available.
    class(dense_matrix), intent(in) :: self
    real(dp), intent(in)  :: x(:)
    real(dp), intent(out) :: y(:)
    integer :: i
    !$omp parallel do default(shared) private(i) schedule(static)
    do i = 1, self%n
      y(i) = dot_product(self%a(i,:), x)
    end do
    !$omp end parallel do
    call dgemv('N', self%n, self%n, 1.0_dp, self%a, self%n, x, 1, 0.0_dp, y, 1)
  end subroutine dense_matvec

  subroutine banded_matvec(self, x, y)
    class(banded_matrix(k=dp, kl=*, ku=*)), intent(in) :: self
    real(dp), intent(in)  :: x(:)
    real(dp), intent(out) :: y(:)
    call dgbmv('N', self%n, self%n, self%kl, self%ku, 1.0_dp, self%ab, self%kl+self%ku+1, x, 1, 0.0_dp, y, 1)
  end subroutine banded_matvec

  impure elemental subroutine dense_finalize(self)
    type(dense_matrix), intent(inout) :: self
    if (allocated(self%a)) deallocate(self%a)
  end subroutine dense_finalize

  function add_dense(a, b) result(c)
    type(dense_matrix), intent(in) :: a, b
    type(dense_matrix) :: c
    c%n = a%n
    c%a = a%a + b%a
  end function add_dense

  subroutine assign_from_array(lhs, rhs)
    type(dense_matrix), intent(out) :: lhs
    real(dp), intent(in) :: rhs(:,:)
    lhs%n = size(rhs, 1)
    lhs%a = rhs
  end subroutine assign_from_array

  !> 2-norm reduced across OpenMP threads and MPI ranks.
  function norm2_parallel(x &
#ifdef USE_MPI
      , comm &
#endif
      ) result(nrm)
    real(dp), intent(in) :: x(:) !! local slice of the vector
#ifdef USE_MPI
    type(MPI_Comm), intent(in) :: comm !! communicator
#endif
    real(dp) :: nrm !! the global 2-norm
    real(dp) :: s
    integer :: i
    s = 0.0_dp
    !$omp parallel do reduction(+:s)
    do i = 1, size(x)
      s = s + x(i)**2
    end do
    !$omp end parallel do
#ifdef USE_MPI
    call MPI_Allreduce(MPI_IN_PLACE, s, 1, MPI_DOUBLE_PRECISION, MPI_SUM, comm)
#endif
    nrm = sqrt(s)
  end function norm2_parallel

  !> A device routine for OpenACC and OpenMP offload.
  pure real(dp) function axpy_elem(a, x, y)
    !$acc routine seq
    !$omp declare target
    real(dp), value :: a, x, y
    axpy_elem = a*x + y
  end function axpy_elem

  !> Rank-generic sum with `select rank` and coarray reduction.
  subroutine rank_sum(x, total)
    real(dp), intent(in) :: x(..)
    real(dp), intent(out) :: total[*]
    select rank (x)
    rank (1)
      total = sum(x)
    rank (2)
      total = sum(x)
    rank default
      total = 0.0_dp
    end select
    call co_sum(total)
  end subroutine rank_sum

  subroutine concurrent_scale(x, alpha)
    real(dp), intent(inout) :: x(:)
    real(dp), intent(in) :: alpha
    integer :: i
    do concurrent (i = 1:size(x)) local_init(alpha)
      x(i) = alpha*x(i)
    end do
  end subroutine concurrent_scale

end module solver_kernels

!> Submodule with the LAPACK-backed implementations.
submodule (solver_kernels) solver_kernels_lapack
  implicit none
contains
  module subroutine solve_dense_real(a, b, info)
    real(dp), intent(inout) :: a(:,:)
    real(dp), intent(inout) :: b(:,:)
    integer,  intent(out), optional :: info
    integer :: ipiv(size(a,1)), stat
    call dgesv(size(a,1), size(b,2), a, size(a,1), ipiv, b, size(b,1), stat)
    if (present(info)) info = stat
  end subroutine solve_dense_real

  module procedure solve_dense_complex
    integer :: ipiv(size(a,1)), stat
    call zgesv(size(a,1), size(b,2), a, size(a,1), ipiv, b, size(b,1), stat)
    if (present(info)) info = stat
  end procedure solve_dense_complex
end submodule solver_kernels_lapack

!> A driver program.
program demo
  !! Runs the kernels; distributed with ScaLAPACK `pdgesv` when built with MPI.
  use solver_kernels
  implicit none
  type(dense_matrix) :: m
  integer :: ctxt, desca(9), info
  m = reshape([1.0d0, 0.0d0, 0.0d0, 1.0d0], [2, 2])
  call blacs_get(-1, 0, ctxt)
  call descinit(desca, 2, 2, 2, 2, 0, 0, ctxt, 2, info)
  print *, m%order()
end program demo
