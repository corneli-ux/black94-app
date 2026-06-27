#!/usr/bin/env python3
"""Inject release signing config into android/app/build.gradle after expo prebuild."""
import sys

gradle_path = sys.argv[1] if len(sys.argv) > 1 else 'android/app/build.gradle'

with open(gradle_path) as f:
    content = f.read()

# Find the signingConfigs block and add release config after the debug block
old = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }"""

new = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('../release.keystore')
            storePassword 'black94release'
            keyAlias 'black94new'
            keyPassword 'black94release'
        }
    }"""

if old not in content:
    print("ERROR: Could not find signingConfigs debug block")
    sys.exit(1)

content = content.replace(old, new)

# Replace debug signingConfig with release
content = content.replace(
    "signingConfig signingConfigs.debug",
    "signingConfig signingConfigs.release"
)

with open(gradle_path, 'w') as f:
    f.write(content)

print(f"Release signing configured in {gradle_path}")
