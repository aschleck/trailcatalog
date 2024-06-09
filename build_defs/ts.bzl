load("@dev_april_corgi//build_defs:ts.bzl", "c_ts_project", _esbuild_binary = "esbuild_binary", _ts_project = "ts_project")

esbuild_binary = _esbuild_binary
tc_ts_project = c_ts_project
ts_project = _ts_project

