#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VibeSwap polyglot diversity-signature generator.

The LANGS table is the source of truth. Each row emits one file that prints the
locked tagline in a different language. Add a language = add a row. Run:

    python generate.py

"Every language in existence" is the asymptote, approached one wave at a time.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MSG = "A coordination primitive, not a casino."

# (subdir, filename, file_content) — content prints MSG in that language.
LANGS = [
    ("python",       "main.py",      f'print("{MSG}")\n'),
    ("javascript",   "main.js",      f'console.log("{MSG}");\n'),
    ("typescript",   "main.ts",      f'const msg: string = "{MSG}";\nconsole.log(msg);\n'),
    ("ruby",         "main.rb",      f'puts "{MSG}"\n'),
    ("go",           "main.go",      f'package main\nimport "fmt"\nfunc main() {{ fmt.Println("{MSG}") }}\n'),
    ("rust",         "main.rs",      f'fn main() {{ println!("{MSG}"); }}\n'),
    ("c",            "main.c",       f'#include <stdio.h>\nint main(void) {{ printf("{MSG}\\n"); return 0; }}\n'),
    ("cpp",          "main.cpp",     f'#include <iostream>\nint main() {{ std::cout << "{MSG}" << std::endl; }}\n'),
    ("csharp",       "Main.cs",      f'using System;\nclass P {{ static void Main() {{ Console.WriteLine("{MSG}"); }} }}\n'),
    ("java",         "Main.java",    f'public class Main {{ public static void main(String[] a) {{ System.out.println("{MSG}"); }} }}\n'),
    ("kotlin",       "main.kt",      f'fun main() {{ println("{MSG}") }}\n'),
    ("swift",        "main.swift",   f'print("{MSG}")\n'),
    ("scala",        "Main.scala",   f'object Main extends App {{ println("{MSG}") }}\n'),
    ("clojure",      "main.clj",     f'(println "{MSG}")\n'),
    ("haskell",      "Main.hs",      f'main :: IO ()\nmain = putStrLn "{MSG}"\n'),
    ("ocaml",        "main.ml",      f'let () = print_endline "{MSG}"\n'),
    ("fsharp",       "Main.fs",      f'printfn "{MSG}"\n'),
    ("elixir",       "main.exs",     f'IO.puts("{MSG}")\n'),
    ("erlang",       "main.erl",     f'-module(main).\n-export([start/0]).\nstart() -> io:format("{MSG}~n").\n'),
    ("elm",          "Main.elm",     f'module Main exposing (main)\nimport Html exposing (text)\nmain = text "{MSG}"\n'),
    ("php",          "main.php",     f'<?php\necho "{MSG}\\n";\n'),
    ("perl",         "main.pl",      f'print "{MSG}\\n";\n'),
    ("raku",         "main.raku",    f'say "{MSG}";\n'),
    ("lua",          "main.lua",     f'print("{MSG}")\n'),
    ("r",            "main.R",       f'cat("{MSG}\\n")\n'),
    ("julia",        "main.jl",      f'println("{MSG}")\n'),
    ("dart",         "main.dart",    f'void main() {{ print("{MSG}"); }}\n'),
    ("groovy",       "main.groovy",  f'println "{MSG}"\n'),
    ("nim",          "main.nim",     f'echo "{MSG}"\n'),
    ("crystal",      "main.cr",      f'puts "{MSG}"\n'),
    ("zig",          "main.zig",     f'const std = @import("std");\npub fn main() void {{ std.debug.print("{MSG}\\n", .{{}}); }}\n'),
    ("v",            "main.v",       f'fn main() {{ println("{MSG}") }}\n'),
    ("d",            "main.d",       f'import std.stdio;\nvoid main() {{ writeln("{MSG}"); }}\n'),
    ("pascal",       "main.pas",     f'program Main;\nbegin\n  writeln(\'{MSG}\');\nend.\n'),
    ("fortran",      "main.f90",     f'program main\n  print *, "{MSG}"\nend program main\n'),
    ("cobol",        "main.cob",     '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. MAIN.\n       PROCEDURE DIVISION.\n           DISPLAY "%s".\n           STOP RUN.\n' % MSG),
    ("ada",          "main.adb",     f'with Ada.Text_IO;\nprocedure Main is\nbegin\n   Ada.Text_IO.Put_Line ("{MSG}");\nend Main;\n'),
    ("commonlisp",   "main.lisp",    f'(format t "{MSG}~%")\n'),
    ("scheme",       "main.scm",     f'(display "{MSG}")(newline)\n'),
    ("racket",       "main.rkt",     f'#lang racket\n(displayln "{MSG}")\n'),
    ("prolog",       "main.pl.pro",  f':- initialization(main).\nmain :- write("{MSG}"), nl.\n'),
    ("smalltalk",    "main.st",      f"Transcript showCr: '{MSG}'.\n"),
    ("tcl",          "main.tcl",     f'puts "{MSG}"\n'),
    ("bash",         "main.sh",      f'#!/usr/bin/env bash\necho "{MSG}"\n'),
    ("powershell",   "main.ps1",     f'Write-Output "{MSG}"\n'),
    ("fish",         "main.fish",    f'echo "{MSG}"\n'),
    ("awk",          "main.awk",     f'BEGIN {{ print "{MSG}" }}\n'),
    ("objectivec",   "main.m",       f'#import <Foundation/Foundation.h>\nint main() {{ @autoreleasepool {{ NSLog(@"{MSG}"); }} }}\n'),
    ("vbnet",        "Main.vb",      f'Module Main\n  Sub Main()\n    Console.WriteLine("{MSG}")\n  End Sub\nEnd Module\n'),
    ("coffeescript", "main.coffee",  f'console.log "{MSG}"\n'),
    ("purescript",   "Main.purs",    f'module Main where\nimport Effect.Console (log)\nmain = log "{MSG}"\n'),
    ("haxe",         "Main.hx",      f'class Main {{ static function main() {{ trace("{MSG}"); }} }}\n'),
    ("solidity",     "Tagline.sol",  f'// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Tagline {{ string public constant MSG = "{MSG}"; }}\n'),
    ("vyper",        "tagline.vy",   f'MSG: public(constant(String[64])) = "{MSG}"\n'),
    ("move",         "tagline.move", f'module vibeswap::tagline {{\n    public fun msg(): vector<u8> {{ b"{MSG}" }}\n}}\n'),
    ("cairo",        "main.cairo",   f'fn main() {{ println!("{MSG}"); }}\n'),
    ("eiffel",       "main.e",       f'class MAIN\ncreate make\nfeature make\n  do\n    print ("{MSG}%N")\n  end\nend\n'),
    ("forth",        "main.fth",     f'." {MSG}" cr\n'),
    ("apl",          "main.apl",     f"'{MSG}'\n"),
    ("j",            "main.ijs",     f"echo '{MSG}'\n"),
    ("factor",       "main.factor",  f'USING: io ;\n"{MSG}" print\n'),
    ("nix",          "default.nix",  f'"{MSG}"\n'),
    ("wren",         "main.wren",    f'System.print("{MSG}")\n'),
    ("gleam",        "main.gleam",   f'import gleam/io\npub fn main() {{ io.println("{MSG}") }}\n'),
    ("odin",         "main.odin",    f'package main\nimport "core:fmt"\nmain :: proc() {{ fmt.println("{MSG}") }}\n'),
    ("mojo",         "main.mojo",    f'fn main():\n    print("{MSG}")\n'),
    ("gdscript",     "main.gd",      f'extends Node\nfunc _ready():\n    print("{MSG}")\n'),
    ("autohotkey",   "main.ahk",     f'MsgBox, {MSG}\n'),
    ("abap",         "main.abap",    f'WRITE: / `{MSG}`.\n'),
    ("sql",          "main.sql",     f"SELECT '{MSG}' AS tagline;\n"),
    ("verilog",      "main.v.sv",    f'module main;\n  initial $display("{MSG}");\nendmodule\n'),
    ("vhdl",         "main.vhd",     f'-- {MSG}\nentity main is\nend main;\n'),
    ("wgsl",         "main.wgsl",    f'// {MSG}\nconst MSG: u32 = 0u;\n'),
    ("glsl",         "main.glsl",    f'// {MSG}\nvoid main() {{}}\n'),
    ("cuda",         "main.cu",      f'#include <cstdio>\n__global__ void k() {{}}\nint main() {{ printf("{MSG}\\n"); }}\n'),
    ("assembly",     "main.asm",     f'; {MSG}\nsection .data\nmsg db "{MSG}", 10\n'),
    ("brainfuck",    "main.bf",      f"{MSG}\n"),
    ("lolcode",      "main.lol",     f'HAI 1.2\nVISIBLE "{MSG}"\nKTHXBYE\n'),
    ("basic",        "main.bas",     f'10 PRINT "{MSG}"\n'),
    ("matlab",       "main.m.matlab",f"disp('{MSG}')\n"),
    ("wat",          "main.wat",     f'(module ;; {MSG}\n  (func (export "tag")))\n'),
    ("hcl",          "main.tf",      f'output "tagline" {{\n  value = "{MSG}"\n}}\n'),
]


def main() -> int:
    n = 0
    for sub, fname, content in LANGS:
        d = os.path.join(HERE, sub)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, fname), "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        n += 1
    print(f"polyglot: wrote {n} languages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
