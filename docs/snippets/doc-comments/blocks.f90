module blocks
  implicit none
contains
  !!------------------------------------------------------------------
  !| Sums the entries of a vector,
  ! in parallel where OpenMP is on.
  !
  ! The order of the additions is not fixed, so the last bits of the sum
  ! can differ from one run to the next.
  subroutine total(x, s)
    real, intent(in) :: x(:)  !! the vector
    real, intent(out) :: s
    !!$omp parallel do reduction(+:s)
    s = sum(x)
  end subroutine total
end module blocks
