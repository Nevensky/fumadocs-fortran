module marks
  implicit none
contains
  !> Scales a vector in place:
  !! each entry is multiplied by the factor.
  subroutine scale(n, x, alpha)
    integer, intent(in) :: n     !< the length of x
    real, intent(inout) :: x(n)  !! the vector, scaled on return
    real, intent(in) :: alpha
    !! the factor
    x = alpha*x
  end subroutine scale
end module marks
