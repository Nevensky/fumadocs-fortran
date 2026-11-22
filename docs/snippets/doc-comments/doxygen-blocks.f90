module doxygen_blocks
  implicit none
contains
  !> \brief Reads a matrix from a file in the Matrix Market format.
  !>
  !> \par Formats
  !> \li \c coordinate: an entry a line, for sparse matrices
  !> \li \c array: every entry, column by column
  !>
  !> A file of the first kind starts so:
  !> \verbatim
  !> %%MatrixMarket matrix coordinate real general
  !>   3 3 2
  !>   1 1 4.0
  !>   3 2 -1.5
  !> \endverbatim
  !> A program reads it with
  !> \code
  !> call read_market('a.mtx', a, info)
  !> \endcode
  !> The format is described in \cite boisvert1997 and on
  !> <a href="https://math.nist.gov/MatrixMarket/">its home page</a>; \ref write_market writes it.\n
  !> Comments in the file are skipped.
  !> \callgraph
  !> \param[in]  file the name of the file
  !> \param[out] a    the matrix
  !> \param[out] info 0, or the number of the line that could not be read
  subroutine read_market(file, a, info)
    character(*), intent(in) :: file
    real, allocatable, intent(out) :: a(:,:)
    integer, intent(out) :: info
  end subroutine read_market

  !> \brief Writes a matrix in the Matrix Market format.
  !> \deprecated Use write_market2, which writes a symmetric matrix in half the space.
  !> \param[in] file the name of the file
  !> \param[in] a    the matrix
  subroutine write_market(file, a)
    character(*), intent(in) :: file
    real, intent(in) :: a(:,:)
  end subroutine write_market
end module doxygen_blocks
