import sys, json
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

audio = decode_audio(sys.argv[2], sampling_rate=16000)
duration = len(audio) / 16000
if duration > 47 or duration < 0.15:
    raise ValueError('Audio duration out of range')
model = WhisperModel(sys.argv[1], device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)
segments, info = model.transcribe(audio, language='es', beam_size=3, vad_filter=True, condition_on_previous_text=False)
text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < 0.65).strip()
print(json.dumps({'text':text, 'language':'es', 'duration':round(duration,2)}, ensure_ascii=True))
