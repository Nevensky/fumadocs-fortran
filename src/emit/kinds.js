// The named constants (and the few derived types) of the intrinsic modules that declarations name as kinds or types,
// each with a line on what it is, for the hover cards of argument rows: `real(dp)` after
// `use iso_fortran_env, only: dp => real64` says what real64 is. `url` is gfortran's page for the module.

// c_int8_t … c_int64_t, and their least and fast kin
const ints = (prefix, what) => Object.fromEntries([8, 16, 32, 64].map((n) => [`${prefix}${n}_t`, what(n)]));

export const INTRINSIC_MODULES = {
  iso_fortran_env: {
    url: 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fFORTRAN_005fENV.html',
    names: {
      int8: 'Integer kind with a storage size of 8 bits',
      int16: 'Integer kind with a storage size of 16 bits',
      int32: 'Integer kind with a storage size of 32 bits',
      int64: 'Integer kind with a storage size of 64 bits',
      real16: 'Real kind with a storage size of 16 bits: half precision, where the compiler has it (Fortran 2023)',
      real32: 'Real kind with a storage size of 32 bits: single precision',
      real64: 'Real kind with a storage size of 64 bits: double precision',
      real128: 'Real kind with a storage size of 128 bits: quadruple precision, where the compiler has it',
      logical8: 'Logical kind with a storage size of 8 bits (Fortran 2023)',
      logical16: 'Logical kind with a storage size of 16 bits (Fortran 2023)',
      logical32: 'Logical kind with a storage size of 32 bits (Fortran 2023)',
      logical64: 'Logical kind with a storage size of 64 bits (Fortran 2023)',
      atomic_int_kind: 'Integer kind of the variables the atomic subroutines work on',
      atomic_logical_kind: 'Logical kind of the variables the atomic subroutines work on',
      lock_type: 'Derived type of a lock variable, for LOCK and UNLOCK on coarrays',
      event_type: 'Derived type of an event variable, for EVENT POST and EVENT WAIT',
      team_type: 'Derived type of a team value, for FORM TEAM and CHANGE TEAM',
      notify_type: 'Derived type of a notify variable, for NOTIFY WAIT (Fortran 2023)',
    },
  },
  iso_c_binding: {
    url: 'https://gcc.gnu.org/onlinedocs/gfortran/ISO_005fC_005fBINDING.html',
    names: {
      c_int: 'Integer kind interoperable with C int',
      c_short: 'Integer kind interoperable with C short',
      c_long: 'Integer kind interoperable with C long',
      c_long_long: 'Integer kind interoperable with C long long',
      c_signed_char: 'Integer kind interoperable with C signed char',
      c_size_t: 'Integer kind interoperable with C size_t',
      ...ints('c_int', (n) => `Integer kind interoperable with C int${n}_t`),
      ...ints('c_int_least', (n) => `Integer kind interoperable with C int_least${n}_t`),
      ...ints('c_int_fast', (n) => `Integer kind interoperable with C int_fast${n}_t`),
      c_int128_t: 'Integer kind interoperable with C __int128 (a GNU extension)',
      c_intmax_t: 'Integer kind interoperable with C intmax_t',
      c_intptr_t: 'Integer kind interoperable with C intptr_t',
      c_ptrdiff_t: 'Integer kind interoperable with C ptrdiff_t (Fortran 2018)',
      c_float: 'Real kind interoperable with C float',
      c_double: 'Real kind interoperable with C double',
      c_long_double: 'Real kind interoperable with C long double',
      c_float128: 'Real kind interoperable with C __float128 (a GNU extension)',
      c_float_complex: 'Complex kind interoperable with C float _Complex',
      c_double_complex: 'Complex kind interoperable with C double _Complex',
      c_long_double_complex: 'Complex kind interoperable with C long double _Complex',
      c_float128_complex: 'Complex kind interoperable with C __float128 _Complex (a GNU extension)',
      c_bool: 'Logical kind interoperable with C _Bool',
      c_char: 'Character kind interoperable with C char',
      c_ptr: 'Derived type interoperable with a C data pointer (void *)',
      c_funptr: 'Derived type interoperable with a C function pointer',
    },
  },
};
