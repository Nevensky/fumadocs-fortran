module notes
  implicit none
contains
  subroutine factor(a, ipiv)
    !! Factors a square matrix into L and U, with partial pivoting.
    !!
    !! @note
    !! The factors overwrite the matrix.
    !! @endnote
    !!
    !! @warning A singular matrix is not detected.
    !!
    !! @bug A matrix of order 0 is read out of bounds.
    !!
    !! @todo Pivot by columns too.
    !!
    !! @history
    !! 2.0: rows are swapped in place.
    !! @endhistory
    real, intent(inout) :: a(:,:)  !! the matrix
    integer, intent(out) :: ipiv(:)  !! the pivots
  end subroutine factor

  !> \brief Solves a system with the factors that factor writes.
  !> \note The factors are not checked.
  !> \attention The pivots must come from the same call.
  !> \remark Several right-hand sides are solved at once.
  !> \bug A right-hand side of length 0 is read.
  !> \todo Solve with the transpose too.
  !> \deprecated Use solve2.
  !> \param[in]     a    the factors
  !> \param[in]     ipiv the pivots
  !> \param[in,out] b    the right-hand sides, then the solutions
  subroutine solve(a, ipiv, b)
    real, intent(in) :: a(:,:)
    integer, intent(in) :: ipiv(:)
    real, intent(inout) :: b(:,:)
  end subroutine solve
end module notes
