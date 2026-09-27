$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskSampleDir = Join-Path $taskRoot 'data\samples'
New-Item -ItemType Directory -Force -Path $taskSampleDir | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' }
    if (-not $voices) { throw 'No English system voice installed' }
    $synth.SelectVoice($voices[0].VoiceInfo.Name)
    $synth.Rate = -1
    $synth.SetOutputToWaveFile((Join-Path $taskSampleDir 'reference.wav'))
    $text = 'Welcome to our little voice workshop. Every story begins with a single sentence.'
    $synth.Speak($text)
    $synth.SetOutputToNull()
    [System.IO.File]::WriteAllText((Join-Path $taskSampleDir 'reference.txt'), $text)
    Write-Output ('Created local synthetic test reference with ' + $synth.Voice.Name)
} finally { $synth.Dispose() }
