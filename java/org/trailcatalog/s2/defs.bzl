load("@rules_nodejs//nodejs:providers.bzl", "declaration_info", "js_module_info")

def _j2cl_typescript(ctx):
    infos = []
    dep_srcs = []
    for dep in ctx.attr.deps:
        if hasattr(dep, "closure_js_library"):
            infos.append(dep.closure_js_library.info)
            dep_srcs += [getattr(dep.closure_js_library, "srcs", depset())]

    as_list = depset(transitive = dep_srcs).to_list()
    output = ctx.actions.declare_file(ctx.attr.name + ".d.ts")
    print(as_list)
    ctx.actions.run_shell(
        tools = [ctx.executable.clutz],
        inputs = infos + as_list,
        outputs = [output],
        command = "\n".join([
        ] + [
            "find \"" + f.path + "\" ! -type d -iname '*.js' >> js_files"
            for f in as_list
        ] + [
            "echo '[[\"roots\", [' > depgraph.json",
            "awk '{ print \"\\\"$0\\\"\"}' js_files | paste -s -d, >> depgraph.json",
            "echo ']]]' >> depgraph.json",
        ] + [
            " ".join([
                ctx.executable.clutz.path,
                "--closure_env",
                "BROWSER",
                "--strict_deps",
                "-o",
                output.path,
                "@js_files",
            ]),
        ]),
    )
    return [
        declaration_info(depset([output])),
        js_module_info(sources = depset(as_list)),
        DefaultInfo(
            files = depset([output] + as_list),
        ),
    ]

j2cl_typescript = rule(
    implementation = _j2cl_typescript,
    attrs = {
        "deps": attr.label_list(
            providers = ["closure_js_library"],
        ),
        "clutz": attr.label(
            cfg = "exec",
            default = "@angular_clutz//:clutz",
            executable = True,
        ),
    },
)
