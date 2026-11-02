import math
import struct
import sys
import wave

rate = 44100
seconds = 52
notes = [130.8128, 164.8138, 195.9977, 146.8324]
with wave.open(sys.argv[1], 'wb') as track:
    track.setnchannels(1)
    track.setsampwidth(2)
    track.setframerate(rate)
    for index in range(rate * seconds):
        t = index / rate
        beat = t % 0.5
        frequency = notes[int(t / 4) % len(notes)]
        pad = sum(math.sin(2 * math.pi * frequency * ratio * t) for ratio in [1, 1.5, 2]) * 0.07
        pulse = math.sin(2 * math.pi * frequency * 4 * t) * math.exp(-beat * 12) * 0.12
        kick = math.sin(2 * math.pi * (48 * beat + 2 * (1 - math.exp(-beat * 25)))) * math.exp(-beat * 22) * 0.16
        fade = min(t / 1.5, 1, max(0, (seconds - t) / 2))
        track.writeframesraw(struct.pack('<h', int((pad + pulse + kick) * fade * 26000)))
