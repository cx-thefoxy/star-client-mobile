// Run once from the project root: node tools/apply-jvm-fix.mjs
// Makes StarGameService pass its JVM args through StarJvm.fix(...). Safe to run repeatedly.
import { readFileSync, writeFileSync } from "node:fs";
const f = "native-android/StarGameService.java";
let s = readFileSync(f, "utf8");
if (s.includes("StarJvm.fix(")) { console.log("Already patched."); process.exit(0); }
const re = /StarJvm\.run\(\s*([^,]+?)\s*,\s*([^;]*?\.toArray\([^)]*(?:\([^)]*\))?[^)]*\))\s*,\s*([^;]+?)\s*\)/;
if (!re.test(s)) { console.error("Could not find the StarJvm.run(...) call in " + f + ". Change it by hand to: StarJvm.run(jre, StarJvm.fix(<args array>), log)"); process.exit(1); }
s = s.replace(re, "StarJvm.run($1, StarJvm.fix($2), $3)");
writeFileSync(f, s);
console.log("Patched " + f + ": " + s.match(/StarJvm\.run\([^;]*;/)[0]);
