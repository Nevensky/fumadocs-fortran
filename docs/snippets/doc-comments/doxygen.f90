module doxygen
  implicit none
contains
  !> \brief Solves a tridiagonal system by the Thomas algorithm.
  !>
  !> \details Overwrites \p d and \p b. Use \c dgtsv from \b LAPACK for a
  !> matrix that needs pivoting; this one is for \e dominant diagonals.
  !>
  !> \param[in]     n  the order of the matrix
  !> \param[in]     dl the sub-diagonal, <tt>n-1</tt> entries
  !> \param[in,out] d  the diagonal; on exit, that of the factor U
  !> \param[in]     du the super-diagonal
  !> \param[in,out] b  the right-hand side; on exit, the solution
  !> \pre The matrix is diagonally dominant.
  !> \post \p b holds the solution.
  !> \warning A zero on the diagonal divides by zero: there is no pivoting.
  !> \see dgtsv, dominance
  !> \author The solver team
  !> \date 2026
  subroutine thomas(n, dl, d, du, b)
    integer, intent(in) :: n
    real, intent(in) :: dl(n-1), du(n-1)
    real, intent(inout) :: d(n), b(n)
  end subroutine thomas

  !> \brief How far a row's diagonal entry outweighs its neighbours.
  !> \param a the entry left of the diagonal
  !> \param b the diagonal entry
  !> \param c the entry right of it
  !> \return the ratio, above 1 for a dominant row
  pure real function dominance(a, b, c)
    real, intent(in) :: a, b, c
    dominance = abs(b) / (abs(a) + abs(c))
  end function dominance
end module doxygen
