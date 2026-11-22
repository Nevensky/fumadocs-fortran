module ford_metadata
  implicit none
contains
  subroutine solve_plain(a, b)
    !! author: The solver team
    !! date: 2024-03-01
    !! version: 2.1
    !! copyright: 2024 The solver team
    !! license: MIT
    !! deprecated: use solve, which pivots
    !! display: public
    !! summary: The old solver.
    !!
    !! Solves the system in place, without pivoting.
    real, intent(inout) :: a(:,:)  !! the matrix, overwritten by its factors
    real, intent(inout) :: b(:)    !! the right-hand side, then the solution
  end subroutine solve_plain
end module ford_metadata
