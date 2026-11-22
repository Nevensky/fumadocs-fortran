module ford_includes
  implicit none
contains
  subroutine advance(t, dt)
    !! Advances the model by one time step.
    !!
    !! {!units.md!}
    real, intent(inout) :: t  !! the model time
    real, intent(in) :: dt    !! the time step
  end subroutine advance
end module ford_includes
