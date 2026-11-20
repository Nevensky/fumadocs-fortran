!> A module with Fortran 2023 features.
module f2023
  implicit none
  enumeration type :: colour
    enumerator :: red, green, blue
  end enumeration type colour
  enumeration type, public :: shade
    enumerator :: light
  end enumeration type
  type :: point !< a point
    real :: x !! the abscissa
  end type point
contains
  simple function twice(x) result(y)
    real, intent(in) :: x
    real :: y
    typeof(x) :: tmp
    classof(x), allocatable :: other
    tmp = x
    y = ( x > 0 ? 2*x : 0.0 )
    y = ( x > 1 ? 1.0 : x < -1 ? -1.0 : x )
    y = f( x > 0 ? a(1:2) : b )
  end function twice
  subroutine images()
    integer :: me[*]
    type(event_type) :: ev[*]
    type(team_type) :: t
    me = this_image()
    sync all
    change team(t)
    end team
    notify wait(nv)
    do concurrent (i = 1:n) local(t) local_init(s) shared(a) default(none) reduce(+:total)
    end do
    call co_broadcast(me, source_image=1)
    error stop 'done', quiet=.true.
    stop 1, quiet=.false.
  end subroutine images
end module f2023
