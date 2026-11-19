#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# This development-only oracle imports FORD (GPL-3.0-or-later), so it is licensed GPL-3.0-or-later, unlike the rest
# of this repository (MIT). It is not part of the published package.
"""ford_dump.py - parse Fortran sources with FORD's Python API and dump the
parsed + correlated model as JSON (no HTML is written).

Usage (run with `python -I`):
  ford_dump.py [--project-file project.md] [--no-preprocess]
               [--macro NAME[=VAL]]... [-I DIR]... [--docmark C] [--predocmark C]
               [--docmark-alt C] [--predocmark-alt C] [--fixed-ext f]...
               [--preprocessor "cpp -traditional-cpp -E -D__GFORTRAN__"]
               [--no-highlight] [--no-locals] [-o out.json] FILE...

Targets FORD 7.x (ProjectSettings dataclass API; tested on 7.0.13).
FORD 6.x used a plain dict for settings and is not supported.

What FORD does not give us and this script adds:
  * source line numbers (FORD never records them): FortranReader is wrapped
    so every entity gets `line` / `line_end` in the ORIGINAL file, also after
    cpp/pcpp preprocessing (linemarkers are honoured);
  * `use` statements with their ONLY/rename lists: FORD discards these
    during correlate(), so they are snapshotted before it;
  * raw (unrendered) Markdown doc text: we never call project.markdown().
"""
from __future__ import annotations

import argparse
import contextlib
import dataclasses
import io
import json
import os
import re
import sys
import textwrap
import time
import traceback
from fnmatch import fnmatch
from pathlib import Path

import ford
from ford import fortran_project, sourceform
from ford import reader as ford_reader
from ford.settings import EntitySettings, ProjectSettings, load_markdown_settings

S = sourceform
FORD_VERSION = getattr(ford, "__version__", "?")

# --------------------------------------------------------------------------
# 1. Line-number instrumentation
# --------------------------------------------------------------------------
LINEMARKER_RE = re.compile(r'^\s*#\s*(?:line\s+)?(\d+)(?:\s+"([^"]*)")?')

_orig_reader_init = ford_reader.FortranReader.__init__
_orig_reader_next = ford_reader.FortranReader.__next__


def _reader_init(self, filename, *args, **kwargs):
    _orig_reader_init(self, filename, *args, **kwargs)
    stream = self.reader
    if getattr(self, "fixed", False) and hasattr(stream, "gi_frame"):
        # convertToFree(stream) generator: grab the underlying stream
        stream = (stream.gi_frame.f_locals or {}).get("stream", stream)
    preprocessed = isinstance(stream, io.StringIO)
    if preprocessed:
        text = stream.getvalue()
    else:
        with open(filename, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    lines = io.StringIO(text).readlines()
    main = os.path.basename(str(filename))
    cur_file, cur_line, linemap = main, 1, []
    for ln in lines:
        m = LINEMARKER_RE.match(ln) if preprocessed else None
        if m:
            cur_line = int(m.group(1))
            if m.group(2) is not None:
                cur_file = os.path.basename(m.group(2))
            linemap.append(None)
        else:
            linemap.append(cur_line if cur_file == main else None)
            cur_line += 1
    self._dump_lines = lines
    self._dump_linemap = linemap
    self._dump_stmt_line = None


def _is_code(line: str, fixed: bool) -> bool:
    s = line.strip()
    if not s:
        return False
    if fixed and line[:1] in "cC*!":
        return False
    return s[0] not in "!#"


def _reader_next(self):
    start = self.line_number
    out = _orig_reader_next(self)
    end = self.line_number
    lines = getattr(self, "_dump_lines", None)
    if lines is not None and end > start:
        for i in range(start, min(end, len(lines))):
            if _is_code(lines[i], self.fixed):
                self._dump_stmt_line = self._dump_linemap[i]
                break
    return out


_orig_base_init = S.FortranBase.__init__
_orig_container_init = S.FortranContainer.__init__
_orig_l2v = S.line_to_variables


def _base_init(self, source, *args, **kwargs):
    self._dump_line = getattr(source, "_dump_stmt_line", None)
    _orig_base_init(self, source, *args, **kwargs)


def _container_init(self, source, *args, **kwargs):
    _orig_container_init(self, source, *args, **kwargs)
    if not isinstance(self, S.FortranSourceFile):
        self._dump_line_end = getattr(source, "_dump_stmt_line", None)


def _l2v(source, *args, **kwargs):
    ln = getattr(source, "_dump_stmt_line", None)
    out = _orig_l2v(source, *args, **kwargs)
    for v in out:
        v._dump_line = ln
    return out


ford_reader.FortranReader.__init__ = _reader_init
ford_reader.FortranReader.__next__ = _reader_next
S.FortranBase.__init__ = _base_init
S.FortranContainer.__init__ = _container_init
S.line_to_variables = _l2v

# --------------------------------------------------------------------------
# 2. Serialisation helpers
# --------------------------------------------------------------------------
OPTS = {"locals": True}


def ref(x):
    """Reference to another entity (name + obj), or the raw string."""
    if x is None or isinstance(x, (str, int, float, bool)):
        return x
    if isinstance(x, (list, tuple)):
        return [ref(i) for i in x]
    name = getattr(x, "name", None)
    if name is None:
        return str(x)
    d = {"name": name, "obj": getattr(x, "obj", type(x).__name__)}
    par = getattr(x, "parent", None)
    if par is not None and not isinstance(par, S.FortranSourceFile) and getattr(par, "name", None):
        d["in"] = par.name
    if getattr(x, "external_url", None):
        d["external_url"] = x.external_url
    return d


def doc_of(e):
    dl = getattr(e, "doc_list", None) or []
    text = textwrap.dedent("\n".join(dl)).strip("\n")
    return text or None


_META_SKIP = {"graph", "graph_maxdepth", "graph_maxnodes", "proc_internals", "source", "num_lines"}


def meta_of(e):
    m = getattr(e, "meta", None)
    if m is None:
        return None
    if dataclasses.is_dataclass(m):
        d = {}
        for f in dataclasses.fields(m):
            if f.name in _META_SKIP:
                continue
            v = getattr(m, f.name)
            if v in (None, [], False, ""):
                continue
            d[f.name] = [str(i) for i in v] if isinstance(v, list) else (str(v) if isinstance(v, Path) else v)
        return d or None
    return m if isinstance(m, dict) and m else None


def base(e, kind):
    d = {"kind": kind, "name": getattr(e, "name", None)}
    perm = getattr(e, "permission", None)
    if perm:
        d["permission"] = perm
    if getattr(e, "_dump_line", None):
        d["line"] = e._dump_line
    if getattr(e, "_dump_line_end", None):
        d["line_end"] = e._dump_line_end
    doc = doc_of(e)
    if doc:
        d["doc"] = doc
    meta = meta_of(e)
    if meta:
        d["meta"] = meta
    return d


def parse_use(entry):
    mod, extra = entry
    name = mod if isinstance(mod, str) else getattr(mod, "name", str(mod))
    d = {"module": name}
    extra = (extra or "").strip()
    if extra.startswith(","):
        extra = extra[1:].strip()
    only = re.match(r"only\s*:(.*)$", extra, re.I)
    items = [i.strip() for i in (only.group(1) if only else extra).split(",") if i.strip()]
    if only:
        d["only"] = items
    elif items:
        d["renames"] = items
    return d


def uses_of(e):
    raw = getattr(e, "_dump_uses", None)
    if raw is not None:
        out = [parse_use(u) for u in raw]
    else:
        out = [{"module": getattr(u, "name", u)} for u in (getattr(e, "uses", None) or [])]
    # after correlate FORD resolves module objects: mark external/intrinsic ones
    resolved = {getattr(u, "name", "").lower(): u for u in (getattr(e, "uses", None) or []) if not isinstance(u, (str, list))}
    for u in out:
        r = resolved.get(u["module"].lower())
        if r is not None and getattr(r, "external_url", None):
            u["external_url"] = r.external_url
    return out


def calls_of(e):
    out = []
    for c in getattr(e, "calls", None) or []:
        if isinstance(c, (list, tuple)):
            out.append("%".join(getattr(i, "name", str(i)) for i in c))
        else:
            out.append(getattr(c, "name", str(c)))
    return out


def ser_var(v):
    if isinstance(v, str):
        return {"kind": "variable", "name": v, "unresolved": True}
    if isinstance(v, S.FortranProcedure):  # dummy procedure argument
        return ser_proc(v)
    if isinstance(v, S.FortranInterface):
        return ser_iface(v)
    if not isinstance(v, S.FortranVariable):
        return ref(v)
    d = base(v, "variable")
    d.update(
        vartype=v.vartype,
        kind_param=v.kind,
        strlen=v.strlen,
        proto=ref(v.proto) if v.proto else None,
        intent=v.intent or None,
        optional=bool(v.optional),
        attribs=list(v.attribs or []),
        dimension=v.dimension or None,
        parameter=bool(v.parameter),
        initial=v.initial,
        points=bool(v.points),
    )
    return {k: val for k, val in d.items() if val not in (None, [], False, "")}


def ser_proc(p):
    if isinstance(p, S.FortranFunction):
        kind = "function"
    elif isinstance(p, S.FortranSubroutine):
        kind = "subroutine"
    elif isinstance(p, S.FortranModuleProcedureImplementation):
        kind = "module_procedure"
    else:
        return ref(p)
    d = base(p, kind)
    d["attribs"] = list(getattr(p, "attribs", None) or [])
    d["args"] = [ser_var(a) for a in getattr(p, "args", None) or []]
    if kind == "function" or (kind == "module_procedure" and getattr(p, "retvar", None)):
        rv = getattr(p, "retvar", None)
        d["result"] = ser_var(rv) if rv is not None and not isinstance(rv, str) else rv
    if getattr(p, "bindC", None):
        d["bind_c"] = p.bindC
    if kind == "module_procedure":
        d["implements"] = ref(getattr(p, "module", None)) if not isinstance(getattr(p, "module", None), bool) else None
    d["uses"] = uses_of(p)
    d["calls"] = calls_of(p)
    add_scope(d, p, top=False)
    return {k: v for k, v in d.items() if v not in (None, [], "")}


def ser_bound(b):
    d = base(b, "boundproc")
    d.update(
        generic=bool(b.generic),
        deferred=bool(b.deferred),
        attribs=list(b.attribs or []),
        proto=ref(b.proto),
        bindings=[ref(x) for x in b.bindings],
    )
    return d


def ser_type(t):
    d = base(t, "type")
    d["extends"] = ref(t.extends)
    d["attribs"] = list(t.attribs or [])
    d["parameters"] = [ser_var(x) for x in getattr(t, "parameters", None) or []]
    own = getattr(t, "local_variables", None)
    comps = own if own is not None else t.variables
    d["components"] = [ser_var(v) for v in comps]
    inherited = [v for v in t.variables if own is not None and v not in own]
    if inherited:
        d["inherited_components"] = [v.name for v in inherited]
    d["boundprocs"] = [ser_bound(b) for b in t.boundprocs]
    d["finalprocs"] = [ref(getattr(f, "procedure", None)) or f.name for f in t.finalprocs]
    d["constructor"] = ref(t.constructor)
    d["sequence"] = bool(getattr(t, "sequence", False))
    return {k: v for k, v in d.items() if v not in (None, [], False)}


def ser_iface(i):
    d = base(i, "interface")
    d["generic"] = bool(i.generic)
    d["abstract"] = bool(i.abstract)
    if not i.generic and hasattr(i, "procedure"):
        d["procedure"] = ser_proc(i.procedure)
        d.setdefault("line", d["procedure"].get("line") if isinstance(d["procedure"], dict) else None)
    else:
        d["subroutines"] = [ser_proc(p) for p in i.subroutines]
        d["functions"] = [ser_proc(p) for p in i.functions]
        d["modprocs"] = [ref(getattr(m, "procedure", None)) or m.name for m in i.modprocs]
    return {k: v for k, v in d.items() if v not in (None, [])}


def ser_enum(e):
    d = base(e, "enum")
    d["enumerators"] = [ser_var(v) for v in e.variables]
    return d


def add_scope(d, e, top=True):
    vs = getattr(e, "variables", None) or []
    if top or OPTS["locals"]:
        d["variables"] = [ser_var(v) for v in vs]
    else:
        d["n_locals"] = len(vs)
    d["types"] = [ser_type(t) for t in getattr(e, "types", None) or []]
    d["enums"] = [ser_enum(x) for x in getattr(e, "enums", None) or []]
    d["interfaces"] = [ser_iface(x) for x in getattr(e, "interfaces", None) or []]
    d["absinterfaces"] = [ser_iface(x) for x in getattr(e, "absinterfaces", None) or []]
    procs = list(getattr(e, "subroutines", None) or []) + list(getattr(e, "functions", None) or [])
    procs.sort(key=lambda p: getattr(p, "_dump_line", 0) or 0)
    d["procedures"] = [ser_proc(p) for p in procs]
    mps = [x for attr in ("modsubroutines", "modfunctions", "modprocedures") for x in (getattr(e, attr, None) or [])]
    for p in mps:
        if p not in procs:
            d.setdefault("procedures", []).append(ser_proc(p))
    d["common"] = [ref(c) for c in (getattr(e, "common", None) or [])]
    d["namelists"] = [ref(n) for n in getattr(e, "namelists", None) or []]


def ser_unit(u, kind):
    d = base(u, kind)
    d["uses"] = uses_of(u)
    if kind == "submodule":
        d["ancestor_module"] = ref(getattr(u, "ancestor_module", None))
        d["parent_submodule"] = ref(getattr(u, "parent_submodule", None))
    if kind == "program":
        d["calls"] = calls_of(u)
    pl = getattr(u, "public_list", None)
    if pl:
        d["public_list"] = sorted(pl)
    add_scope(d, u, top=True)
    for attr in ("pub_procs", "pub_types", "pub_vars", "pub_absints"):
        coll = getattr(u, attr, None)
        if isinstance(coll, dict) and coll:
            d.setdefault("public_entities", {})[attr[4:]] = sorted(coll.keys())
    return {k: v for k, v in d.items() if v not in (None, [], "")}


def ser_file(sf):
    d = {
        "kind": "sourcefile",
        "path": sf.path,
        "fixed_form": bool(sf.fixed),
        "doc": doc_of(sf),
        "modules": [ser_unit(m, "module") for m in sf.modules],
        "submodules": [ser_unit(m, "submodule") for m in sf.submodules],
        "programs": [ser_unit(m, "program") for m in sf.programs],
        "procedures": [ser_proc(p) for p in sorted(sf.subroutines + sf.functions, key=lambda p: getattr(p, "_dump_line", 0) or 0)],
        "blockdata": [ser_unit(b, "blockdata") for b in sf.blockdata],
    }
    return {k: v for k, v in d.items() if v not in (None, [])}


# --------------------------------------------------------------------------
# 3. Walk helpers (uses snapshot, counting)
# --------------------------------------------------------------------------
def walk(e, seen=None):
    seen = seen if seen is not None else set()
    if id(e) in seen or e is None or isinstance(e, str):
        return
    seen.add(id(e))
    yield e
    for attr in ("modules", "submodules", "programs", "blockdata", "subroutines", "functions",
                 "modprocedures", "modsubroutines", "modfunctions", "interfaces", "absinterfaces", "types", "enums", "boundprocs", "variables"):
        for c in getattr(e, attr, None) or []:
            if not isinstance(c, str):
                yield from walk(c, seen)
    if hasattr(e, "procedure") and not isinstance(getattr(e, "procedure"), (str, type(None))):
        yield from walk(e.procedure, seen)
    for a in getattr(e, "args", None) or []:
        if not isinstance(a, str):
            yield from walk(a, seen)


def snapshot_uses(sf):
    for e in walk(sf):
        u = getattr(e, "uses", None)
        if isinstance(u, list):
            e._dump_uses = [list(x) if isinstance(x, (list, tuple)) else [x, ""] for x in u]


def count(sf):
    c = {}
    for e in walk(sf):
        k = type(e).__name__.replace("Fortran", "")
        c[k] = c.get(k, 0) + 1
        if doc_of(e):
            c["_documented"] = c.get("_documented", 0) + 1
    return c


# --------------------------------------------------------------------------
# 4. Driver
# --------------------------------------------------------------------------
def make_settings(a):
    if a.project_file:
        pf = Path(a.project_file)
        settings, _ = load_markdown_settings(pf.parent, pf.read_text(), str(pf))
    else:
        settings = ProjectSettings()
    for key in ("docmark", "predocmark", "docmark_alt", "predocmark_alt", "preprocessor"):
        val = getattr(a, key)
        if val is not None:
            setattr(settings, key, val)
    if a.macro:
        settings.macro = list(settings.macro) + a.macro
    if a.include:
        settings.include = [Path(p).absolute() for p in a.include]
    if a.fixed_ext:
        settings.fixed_extensions = a.fixed_ext
    if a.ext:  # extra free-form extensions, e.g. fypp
        settings.extensions = sorted(set(settings.extensions) | set(a.ext))
    if a.fpp_ext:
        settings.fpp_extensions = sorted(set(settings.fpp_extensions) | set(a.fpp_ext))
    if a.no_preprocess:
        settings.preprocess = False
    settings.src_dir = [Path("/nonexistent")]
    settings.output_dir = Path("/tmp/ford-dump-unused")
    settings.graph = False
    # keep private/protected entities too (FORD prunes by `display` during
    # correlate); the doc generator decides what to show via `permission`.
    settings.display = a.display or ["public", "protected", "private"]
    settings.normalise_paths(Path.cwd())
    if not settings.preprocess:
        settings.fpp_extensions = []
    return settings


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--project-file")
    ap.add_argument("--no-preprocess", action="store_true")
    ap.add_argument("--preprocessor")
    ap.add_argument("--macro", action="append", default=[])
    ap.add_argument("-I", "--include", action="append", default=[])
    ap.add_argument("--docmark")
    ap.add_argument("--predocmark")
    ap.add_argument("--docmark-alt", dest="docmark_alt")
    ap.add_argument("--predocmark-alt", dest="predocmark_alt")
    ap.add_argument("--fixed-ext", action="append")
    ap.add_argument("--ext", action="append", help="extra free-form extension (e.g. fypp)")
    ap.add_argument("--fpp-ext", action="append", help="extra extension to preprocess (e.g. fypp)")
    ap.add_argument("--no-highlight", action="store_true", help="skip FORD's eager Pygments HTML highlighting of every file")
    ap.add_argument("--no-locals", action="store_true", help="only count procedure-local variables")
    ap.add_argument("--display", action="append", help="FORD display filter (default: public, protected, private)")
    ap.add_argument("-o", "--output")
    a = ap.parse_args(argv)
    OPTS["locals"] = not a.no_locals
    if a.no_highlight:
        S.highlight = lambda *args, **kw: ""

    t_start = time.perf_counter()
    settings = make_settings(a)
    files = [f for f in a.files if not any(fnmatch(os.path.basename(f), x) or fnmatch(f, x) for x in settings.exclude)]
    excluded = sorted(set(a.files) - set(files))

    fortran_project.find_all_files = lambda s: set()
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        project = fortran_project.Project(settings)
    per_file = []
    for f in files:
        ext = Path(f).suffix[1:]
        rec = {"path": f}
        buf = io.StringIO()
        t0 = time.perf_counter()
        with contextlib.redirect_stdout(buf):
            try:
                if ext in settings.extensions + settings.fixed_extensions:
                    n_before = len(project.files)
                    project._fortran_file(ext, Path(f), settings)
                    sf = project.files[-1] if len(project.files) > n_before else None
                    if sf is not None:
                        snapshot_uses(sf)
                        rec["preprocessed"] = ext in settings.fpp_extensions
                        rec["fixed_form"] = ext in settings.fixed_extensions
                else:
                    rec["error"] = f"extension .{ext} not handled by FORD settings"
            except Exception as e:  # noqa: BLE001
                rec["error"] = f"{type(e).__name__}: {e}"
                rec["traceback"] = traceback.format_exc(limit=3)
        rec["parse_seconds"] = round(time.perf_counter() - t0, 3)
        msgs = [ln for ln in buf.getvalue().splitlines() if re.search(r"ERROR|Warning|error", ln)]
        if msgs:
            rec["ford_messages"] = msgs[:20]
        per_file.append(rec)

    t0 = time.perf_counter()
    cbuf = io.StringIO()
    corr = {"ok": True}
    with contextlib.redirect_stdout(cbuf):
        try:
            project.correlate()
        except Exception as e:  # noqa: BLE001
            corr = {"ok": False, "error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc(limit=4)}
    corr["seconds"] = round(time.perf_counter() - t0, 3)
    msgs = [ln for ln in cbuf.getvalue().splitlines() if ln.strip()]
    if msgs:
        corr["ford_messages"] = msgs[:30]

    by_path = {sf.path: sf for sf in project.files}
    out_files, totals = [], {}
    t0 = time.perf_counter()
    for rec in per_file:
        sf = by_path.get(str(Path(rec["path"])))
        if sf is not None:
            entry = ser_file(sf)
            c = count(sf)
            for k, v in c.items():
                totals[k] = totals.get(k, 0) + v
            entry.update({k: v for k, v in rec.items() if k != "path"})
            entry["counts"] = c
        else:
            entry = rec
        out_files.append(entry)
    ser_s = round(time.perf_counter() - t0, 3)

    result = {
        "generator": "ford_dump.py",
        "ford_version": FORD_VERSION,
        "settings": {k: (str(v) if isinstance(v, Path) else v) for k, v in {
            "docmark": settings.docmark, "predocmark": settings.predocmark,
            "docmark_alt": settings.docmark_alt, "predocmark_alt": settings.predocmark_alt,
            "preprocess": settings.preprocess, "preprocessor": settings.preprocessor,
            "fpp_extensions": settings.fpp_extensions, "fixed_extensions": settings.fixed_extensions,
            "extensions": sorted(settings.extensions), "macro": settings.macro,
            "doxygen": getattr(settings, "doxygen", None), "exclude": settings.exclude}.items()},
        "excluded_files": excluded,
        "correlate": corr,
        "timing": {"total_seconds": round(time.perf_counter() - t_start, 3), "serialise_seconds": ser_s},
        "totals": totals,
        "files": out_files,
    }
    text = json.dumps(result, indent=1, default=lambda o: ref(o))
    if a.output:
        Path(a.output).write_text(text)
    else:
        sys.stdout.write(text)
    summary = {"files": len(files), "errors": sum(1 for r in per_file if "error" in r),
               "correlate_ok": corr["ok"], "seconds": result["timing"]["total_seconds"],
               "json_bytes": len(text.encode()), "totals": totals}
    print(json.dumps(summary), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
