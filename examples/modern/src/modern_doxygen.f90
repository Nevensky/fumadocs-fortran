!> @file modern_doxygen.f90
!> @brief Doxygen-style documentation, as used by LAPACK-derived and many HPC codes.
!>
!> @details The module wraps a few BLAS/LAPACK calls.

!> @brief Eigen-solvers.
!> @author A. Person
module eigen_wrappers
  use iso_fortran_env, only: wp => real64
  implicit none
  private
  public :: eigh, gemm_wrap

  integer, parameter :: max_iter = 100 !< iteration cap (Doxygen post-comment)

contains

  !> @brief Eigenvalues of a Hermitian matrix with LAPACK zheevd: \f$ A v = \lambda v \f$.
  !>
  !> @details Diagonalises the matrix in place by divide and conquer,
  !> \f[ A = V \Lambda V^{H}, \qquad \Lambda = \mathrm{diag}(w_1, \dots, w_n), \f]
  !> where the columns of \f$V\f$ are the orthonormal eigenvectors.
  !>
  !> @param[in,out] a    on entry the Hermitian matrix; on exit the eigenvectors
  !> @param[out]    w    the eigenvalues in ascending order, $w_1 \le w_2 \le \dots \le w_n$
  !> @param[out]    info LAPACK info code: 0 on success
  !> @returns nothing; it is a subroutine
  !> @see zheevd
  subroutine eigh(a, w, info)
    complex(wp), intent(inout) :: a(:,:)
    real(wp),    intent(out)   :: w(:)
    integer,     intent(out)   :: info
    complex(wp), allocatable :: work(:)
    real(wp),    allocatable :: rwork(:)
    integer,     allocatable :: iwork(:)
    integer :: n, lwork, lrwork, liwork
    n = size(a, 1)
    lwork = 2*n + n*n
    lrwork = 1 + 5*n + 2*n*n
    liwork = 3 + 5*n
    allocate(work(lwork), rwork(lrwork), iwork(liwork))
    call zheevd('V', 'U', n, a, n, w, work, lwork, rwork, lrwork, iwork, liwork, info)
  end subroutine eigh

  !> \brief \f$ C \leftarrow \alpha A B + \beta C \f$ with BLAS dgemm.
  !> \param[in] alpha scale of the product
  !> \param[in] a left factor
  !> \param[in] b right factor
  !> \param[in] beta scale of C
  !> \param[in,out] c accumulator
  subroutine gemm_wrap(alpha, a, b, beta, c)
    real(wp), intent(in)    :: alpha   !< scale of A*B
    real(wp), intent(in)    :: a(:,:)  !< left factor
    real(wp), intent(in)    :: b(:,:)  !< right factor
    real(wp), intent(in)    :: beta    !< scale of C
    real(wp), intent(inout) :: c(:,:)  !< accumulator
    call dgemm('N', 'N', size(a,1), size(b,2), size(a,2), alpha, a, size(a,1), &
               b, size(b,1), beta, c, size(c,1))
  end subroutine gemm_wrap

end module eigen_wrappers
