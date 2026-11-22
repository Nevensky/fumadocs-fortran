module ford_links
  implicit none
  type :: grid
    integer :: n = 0           !! the number of points
    real, allocatable :: x(:)  !! their coordinates
  end type grid
contains
  subroutine refine(g)
    !! Halves the spacing of a [[grid]], so that [[grid:n]] becomes 2n - 1.
    !! [[coarsen]] undoes it, and [[interpolate]] moves a field onto the new points.
    type(grid), intent(inout) :: g  !! the grid
  end subroutine refine
  subroutine coarsen(g)
    !! Keeps every other point of a [[grid(type)]].
    type(grid), intent(inout) :: g  !! the grid
  end subroutine coarsen
end module ford_links
