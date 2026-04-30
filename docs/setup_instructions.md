# Setup Instructions: JDK 17

RoomFindR Android builds should use JDK 17.

## Install JDK 17

- Azul Zulu: https://www.azul.com/downloads/?version=java-17-lts&os=windows&architecture=x86-64-bit&package=jdk
- Adoptium Temurin: https://adoptium.net/temurin/releases/?version=17

## Set environment variables

1. Open Windows system environment variables.
2. Set `JAVA_HOME` to your JDK 17 installation path.
3. Ensure `%JAVA_HOME%\\bin` is present in `Path`.

## Verify

Open a new terminal and run:

```powershell
java -version
```

It should report `17.x`.

## IDE note

If your IDE is using another Java runtime, point it to JDK 17 before running Gradle sync or Android builds.
