// Hand-written MPI data: our own classification and one-liners, no text from the MPI standard.

/**
 * Procedures outside the collective-communication chapter that every process of the communicator (or group, window,
 * file) must call. With the collective operations themselves, these get the `coll` tag.
 */
export const COLLECTIVE = [
  'MPI_Init',
  'MPI_Init_thread',
  'MPI_Finalize',
  'MPI_Comm_create',
  'MPI_Comm_create_group',
  'MPI_Comm_create_from_group',
  'MPI_Comm_dup',
  'MPI_Comm_dup_with_info',
  'MPI_Comm_idup',
  'MPI_Comm_idup_with_info',
  'MPI_Comm_split',
  'MPI_Comm_split_type',
  'MPI_Comm_free',
  'MPI_Comm_disconnect',
  'MPI_Comm_set_info',
  'MPI_Comm_spawn',
  'MPI_Comm_spawn_multiple',
  'MPI_Comm_accept',
  'MPI_Comm_connect',
  'MPI_Intercomm_create',
  'MPI_Intercomm_create_from_groups',
  'MPI_Intercomm_merge',
  'MPI_Cart_create',
  'MPI_Cart_sub',
  'MPI_Graph_create',
  'MPI_Dist_graph_create',
  'MPI_Dist_graph_create_adjacent',
  'MPI_Win_create',
  'MPI_Win_allocate',
  'MPI_Win_allocate_shared',
  'MPI_Win_create_dynamic',
  'MPI_Win_free',
  'MPI_Win_fence',
  'MPI_Win_set_info',
  'MPI_File_open',
  'MPI_File_close',
  'MPI_File_set_size',
  'MPI_File_preallocate',
  'MPI_File_set_view',
  'MPI_File_set_info',
  'MPI_File_set_atomicity',
  'MPI_File_sync',
  'MPI_File_seek_shared',
];

/** MPI-IO procedures whose names mark them collective: *_all, *_all_begin/_end, *_ordered, *_ordered_begin/_end. */
export const COLLECTIVE_IO = /^MPI_File_(?:\w+_all(?:_begin|_end)?|\w+_ordered(?:_begin|_end)?)$/;

/**
 * Deprecated procedures the catalogue lists as standard: the MPI-1 attribute interface (deprecated since MPI-2.0 and
 * left out of the MPI 5.0 ABI), and the info and size queries deprecated in MPI 4.0.
 */
export const DEPRECATED = new Set([
  'MPI_Attr_delete',
  'MPI_Attr_get',
  'MPI_Attr_put',
  'MPI_Keyval_create',
  'MPI_Keyval_free',
  'MPI_Info_get',
  'MPI_Info_get_valuelen',
  'MPI_Sizeof',
]);

/** Callback interfaces and predefined callbacks: our one-liner and the procedure that takes them. */
export const CALLBACKS = {
  MPI_User_function: ['Interface of a user-defined reduction operation.', 'MPI_Op_create'],
  MPI_Comm_copy_attr_function: ['Interface of the routine that copies a communicator attribute when the communicator is duplicated.', 'MPI_Comm_create_keyval'],
  MPI_Comm_delete_attr_function: ['Interface of the routine that deletes a communicator attribute.', 'MPI_Comm_create_keyval'],
  MPI_Type_copy_attr_function: ['Interface of the routine that copies a datatype attribute when the datatype is duplicated.', 'MPI_Type_create_keyval'],
  MPI_Type_delete_attr_function: ['Interface of the routine that deletes a datatype attribute.', 'MPI_Type_create_keyval'],
  MPI_Win_copy_attr_function: ['Interface of the routine that copies a window attribute.', 'MPI_Win_create_keyval'],
  MPI_Win_delete_attr_function: ['Interface of the routine that deletes a window attribute.', 'MPI_Win_create_keyval'],
  MPI_Comm_errhandler_function: ['Interface of a user-defined error handler for communicators.', 'MPI_Comm_create_errhandler'],
  MPI_File_errhandler_function: ['Interface of a user-defined error handler for files.', 'MPI_File_create_errhandler'],
  MPI_Win_errhandler_function: ['Interface of a user-defined error handler for windows.', 'MPI_Win_create_errhandler'],
  MPI_Session_errhandler_function: ['Interface of a user-defined error handler for sessions.', 'MPI_Session_create_errhandler'],
  MPI_Grequest_query_function: ['Interface of the routine that fills in the status of a generalised request.', 'MPI_Grequest_start'],
  MPI_Grequest_free_function: ['Interface of the routine that frees a generalised request.', 'MPI_Grequest_start'],
  MPI_Grequest_cancel_function: ['Interface of the routine that cancels a generalised request.', 'MPI_Grequest_start'],
  MPI_Datarep_conversion_function: ['Interface of a data-representation conversion routine for MPI-IO.', 'MPI_Register_datarep'],
  MPI_Datarep_extent_function: ['Interface of the routine that gives a datatype’s extent in a user-defined data representation.', 'MPI_Register_datarep'],
  MPI_COMM_NULL_COPY_FN: ['Predefined copy callback: the attribute is not copied to the new communicator.', 'MPI_Comm_create_keyval'],
  MPI_COMM_DUP_FN: ['Predefined copy callback: the attribute value is copied to the new communicator.', 'MPI_Comm_create_keyval'],
  MPI_COMM_NULL_DELETE_FN: ['Predefined delete callback that does nothing.', 'MPI_Comm_create_keyval'],
  MPI_TYPE_NULL_COPY_FN: ['Predefined copy callback: the attribute is not copied to the new datatype.', 'MPI_Type_create_keyval'],
  MPI_TYPE_DUP_FN: ['Predefined copy callback: the attribute value is copied to the new datatype.', 'MPI_Type_create_keyval'],
  MPI_TYPE_NULL_DELETE_FN: ['Predefined delete callback that does nothing.', 'MPI_Type_create_keyval'],
  MPI_WIN_NULL_COPY_FN: ['Predefined copy callback: the attribute is not copied to the new window.', 'MPI_Win_create_keyval'],
  MPI_WIN_DUP_FN: ['Predefined copy callback: the attribute value is copied to the new window.', 'MPI_Win_create_keyval'],
  MPI_WIN_NULL_DELETE_FN: ['Predefined delete callback that does nothing.', 'MPI_Win_create_keyval'],
  MPI_CONVERSION_FN_NULL: ['Predefined conversion callback for data representations that need no conversion.', 'MPI_Register_datarep'],
  MPI_NULL_COPY_FN: ['Deprecated predefined copy callback; use MPI_COMM_NULL_COPY_FN.', 'MPI_Keyval_create'],
  MPI_DUP_FN: ['Deprecated predefined copy callback; use MPI_COMM_DUP_FN.', 'MPI_Keyval_create'],
  MPI_NULL_DELETE_FN: ['Deprecated predefined delete callback; use MPI_COMM_NULL_DELETE_FN.', 'MPI_Keyval_create'],
};
