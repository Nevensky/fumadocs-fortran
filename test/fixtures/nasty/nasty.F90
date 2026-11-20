!> Doc comments written to break an MDX page: every line below is something real projects write.
!> import numpy as np  (a paragraph that starts with import)
!>
!> export OMP_NUM_THREADS=4
!>
!> Braces {like this} and {{double}}, a lone }, <not a tag>, <br>, <b>bold</b>, a < b > c, a<b, x&y, &amp; &nbsp;
!> <!-- an HTML comment --> <https://example.org/autolink> <script>alert(1)</script> <div class="x">div</div>
!> Maths with braces \( a_{ij} = \frac{1}{2} \) and display:
!> \[ \sum_{k=1}^{n} x_k^{2} \]
!> $$ e^{i\pi} + 1 = 0 $$ and a dollar sign $5 for a coffee, and $ alone.
!> A table:
!>
!> | col {1} | col <2> |
!> |---|---|
!> | a\|b | `c|d` |
!>
!>     indented code {x}
!>     more code <y>
!>
!> ```fortran
!> x = {1, 2} ! <not a tag>
!> ```
!> # A heading in a doc
!> ## Another one
!> * list item with {braces}
!> 1. numbered <item>
!> > a quote with {brace}
!> Trailing backslash \
!> Unbalanced `backtick and *emphasis and _under
!> [[unknown_entity]] and [[nasty_mod:inner]] and [a link](https://x.org/{y}) and ![img](x.png)
module nasty_mod
  !! @note
  !! A note with {braces} and <tags> and a nested @warning inside.
  !! @endnote
  !!
  !! @warning
  !! Unterminated warning that runs to the blank line {x}
  !!
  !! @todo something with `code {x}`
  implicit none
  integer, parameter :: weird = 1 !! a doc with a pipe | and a hash # and a star * and {brace}

contains

  !> \brief Doxygen with <b>bold</b>, \c code, \e emph, \f$ x^{2} \f$ and {braces} and <tags>.
  !> \details A * B = C where B(LDB,*) and _underscore_ and [bracket] and #hash and import x.
  !> \param[in] x the input {x} with <angle> and `code`
  !> \param[out] y the output, see \ref inner
  !> \return nothing {really}
  !> \code{.f90}
  !>   call inner(x, y)  ! {code}
  !> \endcode
  !> \verbatim
  !>   = 0: ok {fine}
  !>   < 0: bad <worse>
  !> \endverbatim
  !> \f[ \int_0^1 f(x)\,dx \f]
  !> \note A Doxygen note with {x}.
  !> \see inner, outer()
  !> \author Someone <someone@example.org>
  subroutine inner(x, y)
    real, intent(in) :: x   !< trailing {doc} <b>with</b> markup
    real, intent(out) :: y  !< another `one` with a | pipe
    y = x
  end subroutine inner

  !> export default function broken() {}
  !>
  !> import { x } from 'y';
  function outer(s) result(r)
    character(len=*), intent(in) :: s !! a "quoted" doc with 'single' quotes and `back`ticks``
    character(len=len(s)) :: r !! result with $ and \$ and \\
    r = s
  end function outer

end module nasty_mod
