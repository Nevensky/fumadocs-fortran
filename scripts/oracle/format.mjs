// One line per dummy argument, for golden files and the gate: `x real(dp) intent(in) dims(:)`.

export function formatArg(a) {
  let s = `${a.name} ${a.type ? a.type.text : '?'}`;
  if (a.intent) s += ` intent(${a.intent})`;
  if (a.optional) s += ' optional';
  if (a.value) s += ' value';
  if (a.dims) s += ` dims(${a.dims.join(',')})`;
  if (a.codims) s += ` codims[${a.codims.join(',')}]`;
  if (a.cond) s += ` if(${a.cond.join(' && ')})`;
  return s;
}
