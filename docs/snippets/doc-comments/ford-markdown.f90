module ford_markdown
  implicit none
contains
  subroutine smooth(x, passes)
    !! Smooths a signal in place with a three-point *moving average*.
    !!
    !! ## Method
    !!
    !! Each pass replaces every interior entry by the mean of itself and its
    !! two neighbours, so `x(1)` and `x(n)` keep their values.
    !!
    !! | passes | effect                            |
    !! |--------|-----------------------------------|
    !! | 1      | damps the highest frequency       |
    !! | 4      | damps the upper half of the range |
    !!
    !! ```fortran
    !! call smooth(signal, passes=4)
    !! ```
    !!
    !! A pass computes, for i from 2 to n - 1,
    !!
    !!     y(i) = (x(i-1) + x(i) + x(i+1)) / 3
    !!
    !! from the values of the pass before, <b>not</b> those it has just written.
    real, intent(inout) :: x(:)    !! the signal
    integer, intent(in) :: passes  !! how many passes to make
  end subroutine smooth
end module ford_markdown
