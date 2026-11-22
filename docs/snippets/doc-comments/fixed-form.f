*> Scales a vector by a constant.
      SUBROUTINE SSCALX(N, SA, SX)
      INTEGER N
C< the length of SX
      REAL SA
c< the factor
      REAL SX(N)
*< the vector, scaled on return
      SX = SA*SX
      END
