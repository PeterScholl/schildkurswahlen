<#
    .SYNOPSIS
    Lädt SchildKurswahlen per WinSCP (FTPS) auf den Live-Webspace hoch.

    .DESCRIPTION
    Entspricht dem, was bisher von Hand in WinSCP gemacht wurde - nur automatisiert, analog zu den
    rclone-basierten Deploy-Skripten auf dem Linux-Laptop. Ruft dafür winscp-deploy.txt über die
    WinSCP-Konsole (WinSCP.com) auf.

    Voraussetzung: In WinSCP muss einmalig eine gespeicherte Site mit dem Namen aus -SessionName
    angelegt sein (Host, Port, Protokoll/Verschlüsselung, Benutzername und Passwort dort speichern -
    bewusst nicht in diesem Skript, siehe README.md Abschnitt "Deploy"). Sonst fragt WinSCP im
    Batch-Modus danach und das Skript bleibt hängen.

    Es werden nur neue/geänderte Dateien hochgeladen/überschrieben - nichts wird auf dem Server gelöscht
    (siehe winscp-deploy.txt). Entwicklungs-/interne Dateien (.git, .claude, deploy/, testdaten/,
    PLANUNG.md, .gitignore) werden dabei ausgeschlossen, README.md aber bewusst mit hochgeladen.

    .PARAMETER SessionName
    Name der gespeicherten WinSCP-Site. Standard: "schildkurswahlen-deploy" - beim erstmaligen
    Einrichten in WinSCP unter diesem Namen speichern, oder hier den tatsächlich gewählten Namen angeben.

    .EXAMPLE
    .\deploy\deploy.ps1
    .EXAMPLE
    .\deploy\deploy.ps1 -SessionName "mein-anderer-site-name"
#>
param(
    [string]$SessionName = "schildkurswahlen-deploy"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptFile = Join-Path $PSScriptRoot "winscp-deploy.txt"

$winscp = Join-Path ${env:ProgramFiles(x86)} "WinSCP\WinSCP.com"
if (-not (Test-Path $winscp)) {
    $winscp = Join-Path $env:ProgramFiles "WinSCP\WinSCP.com"
}
if (-not (Test-Path $winscp)) {
    throw "WinSCP.com wurde nicht gefunden (weder unter 'Program Files (x86)' noch 'Program Files'). Bitte WinSCP installieren oder den Pfad in deploy.ps1 anpassen."
}
if (-not (Test-Path $scriptFile)) {
    throw "winscp-deploy.txt nicht gefunden unter $scriptFile."
}

Write-Host "Deploye $repoRoot nach WinSCP-Site '$SessionName' ..."

# WinSCP-Skript-Parameter %1%/%2% - lokaler Pfad mit abschließendem Backslash, damit "synchronize
# remote" den *Inhalt* des Ordners synchronisiert statt den Ordner selbst als Unterordner anzulegen.
$localPath = $repoRoot.TrimEnd('\') + '\'

& $winscp /script="$scriptFile" /parameter "$SessionName" "$localPath"
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    throw "WinSCP-Deploy fehlgeschlagen (Exit-Code $exitCode)."
}

Write-Host "Deploy abgeschlossen."
