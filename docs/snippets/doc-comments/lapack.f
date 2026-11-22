*> \brief \b DSCALX
*
*> \par Purpose:
*  =============
*>
*> \verbatim
*>
*> DSCALX scales a vector by a constant, as DSCAL does, and checks
*> its arguments first.
*> \endverbatim
*
*  Arguments:
*  ==========
*
*> \param[in] N
*> \verbatim
*>          N is INTEGER
*>          The number of elements of DX.  N >= 0.
*> \endverbatim
*>
*> \param[in] DA
*> \verbatim
*>          DA is DOUBLE PRECISION
*>          The constant.
*> \endverbatim
*>
*> \param[in,out] DX
*> \verbatim
*>          DX is DOUBLE PRECISION array, dimension (N)
*>          On entry, the vector; on exit, the vector scaled by DA.
*> \endverbatim
*>
*> \param[out] INFO
*> \verbatim
*>          INFO is INTEGER
*>          = 0:  successful exit
*>          < 0:  if INFO = -i, the i-th argument had an illegal value
*> \endverbatim
*
*> \ingroup scalx
*
      SUBROUTINE DSCALX( N, DA, DX, INFO )
      INTEGER            INFO, N
      DOUBLE PRECISION   DA
      DOUBLE PRECISION   DX( * )
      INTEGER            I
      INFO = 0
      IF( N.LT.0 ) THEN
         INFO = -1
         RETURN
      END IF
      DO 10 I = 1, N
         DX( I ) = DA*DX( I )
   10 CONTINUE
      RETURN
      END
