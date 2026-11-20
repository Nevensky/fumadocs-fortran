subroutine offload(a, b, n)
  integer, intent(in) :: n
  real(8), intent(inout) :: a(n,n), b(n,n)
  integer :: i, j
  !$omp target teams distribute parallel do collapse(2) map(tofrom: a) map(to: b)
  do j = 1, n
    do i = 1, n
      a(i,j) = a(i,j) + b(i,j)
    end do
  end do
  !$omp end target teams distribute parallel do
  !$omp parallel do private(i) &
  !$omp& shared(a) schedule(dynamic, 4) reduction(+:s)
  do i = 1, n
    a(i,1) = 0
  end do
  !$OMP LOOP BIND(THREAD)
  !$omp masked
  !$omp end masked
  !$omp declare simd(f) uniform(n) linear(ref(x): 1)
  !$omp declare_simd(f) notinbranch
  !$omp critical(update) hint(omp_sync_hint_contended)
  !$omp end critical(update)
  !$omp target data map(alloc: a(1:n)) if(target: n > 100)
  !$omp target enter data map(to: a)
  !$omp target_data map(from: b) depend(iterator(k=1:n), in: a(k,1))
  !$omp begin declare_target device_type(nohost)
  !$omp end declare target
  !$omp tile sizes(4, 4)
  !$omp unroll partial(4)
  !$omp metadirective when(device={kind(gpu)}: teams loop) otherwise(parallel do)
  !$omp atomic update seq_cst
  !$omp requires unified_shared_memory reverse_offload
  !$omp error at(execution) severity(warning) message("not tuned")
  !$omp parallel do ! a trailing comment
  !$ompx bare ompx_attribute(x)
  !$ print *, omp_get_num_threads()
  !$ use omp_lib
  !$acc parallel loop gang vector copyin(b) copy(a) async(1)
  !$acc end parallel loop
  !$acc kernels num_gangs(4)
  !$acc end kernels
  !$acc data copy(capture: x) create(zero: y)
  !$acc routine(foo) seq
  !$acc wait(1) async(2)
  !$acc loop gang(dim:2) private(tmp) reduction(max: m)
  !$acc enter data copyin(readonly: a) if(n > 0)
  !dir$ ivdep
  !DEC$ ATTRIBUTES DLLEXPORT :: offload
  !GCC$ unroll 4
  !$cuf kernel do(2) <<<*,*>>>
  !@cuf call cuda_sync()
  !!$omp parallel do
  x = 1 !$omp not a directive
  print *, '!$omp in a string'
  call omp_set_num_threads(4)
end subroutine offload
