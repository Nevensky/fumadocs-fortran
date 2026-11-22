module maths
  implicit none
contains
  pure real function energy(m, v)
    !! The kinetic energy \( E = \tfrac{1}{2} m \lVert v \rVert^2 \) of a body,
    !! whose derivative is
    !!
    !! \[ \frac{\partial E}{\partial v_i} = m v_i , \]
    !!
    !! so that $$ \nabla_v E = m v . $$
    !!
    !! \begin{equation}
    !!   E = \frac{p^2}{2m}, \quad p = m \lVert v \rVert
    !! \end{equation}
    !!
    !! These are not maths: $OMP_NUM_THREADS, a !$omp line, and $5 or $10.
    real, intent(in) :: m     !! the mass, $m > 0$
    real, intent(in) :: v(3)  !! the velocity
    energy = 0.5*m*sum(v**2)
  end function energy

  !> \brief The momentum \f$ p = m v \f$ of a body.
  !> \details Each component is
  !> \f[ p_i = m v_i , \qquad i = 1, 2, 3 . \f]
  !> \param m the mass
  !> \param v the velocity
  pure function momentum(m, v) result(p)
    real, intent(in) :: m, v(3)
    real :: p(3)
    p = m*v
  end function momentum
end module maths
