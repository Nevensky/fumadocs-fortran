*> \brief SAXPY computes y := a*x + y.
C> More documentation.
C     A plain comment.
c     Another plain comment.
      SUBROUTINE SAXPY(N, A, X, Y)
      INTEGER N, I
      REAL A, X(N), Y(N)
C$OMP PARALLEL DO PRIVATE(I)
*$OMP& SHARED(X,Y)
!$OMP& SCHEDULE(STATIC)
      DO 10 I = 1, N
         Y(I) = A*X(I) + Y(I)                                           SEQ00010
   10 CONTINUE
C$OMP END PARALLEL DO
c$acc kernels
C$    CALL OMP_SET_NUM_THREADS(4)
D     PRINT *, 'debug'
      X = A + B                                                         1234567890 TRAILING
     &  + C
      CALL DAXPY(N, A, X, 1, Y, 1) ! trailing comment
      PRINT *, 'A STRING THAT IS LONG ENOUGH TO RUN PAST COLUMN 72 OF THE CARD'
CDIR$ IVDEP
      END
