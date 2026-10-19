Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $speaker.GetInstalledVoices()
$voices | ForEach-Object { $_.VoiceInfo.Name }
$spanish = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'es-*' } | Select-Object -First 1
if ($spanish) { $speaker.SelectVoice($spanish.VoiceInfo.Name) }
$speaker.SetOutputToWaveFile((Join-Path $PSScriptRoot '../data/voice-test.wav'))
$speaker.Speak('Mostrar los proyectos')
$speaker.Dispose()
