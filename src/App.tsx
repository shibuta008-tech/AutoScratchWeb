import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type ScratchMode =
  | '---' | '>' | '>>' | '<' | '<<'
  | 'FWD' | 'FSTP' | 'BWD' | 'BSTP'
  | 'BABY' | 'IBBY' | 'B2BY'
  | 'XFMR' | 'CHRP' | '2CHP' | 'FLRE'
  | 'SLCE' | 'RLSE'
  | 'TEAR' | '2TER' | 'ORBT' | 'SCRB'

type CrossfaderAction = 'open' | 'closed' | 'chop' | 'chopFront' | 'cut2' | 'cut3'
type CueSlot = 'cue1' | 'cue2' | null

type ThemeMode = 'light' | 'dark'
type Subdivision = 4 | 8 | 16

type SequencerStep = {
  id: number
  mode: ScratchMode
  velocity: number
  crossfader: CrossfaderAction
  cueSlot: CueSlot
}

type ProcessorPositionMessage = {
  type: 'position'
  currentTime: number
  speed: number
}

const PUBLIC_BASE_URL = import.meta.env.BASE_URL

function publicAssetUrl(path: string) {
  return `${PUBLIC_BASE_URL}${path.replace(/^\//, '')}`
}

const AUDIO_FILE_ACCEPT = '.mp3,.wav,.m4a,.aac,.aif,.aiff,.flac,.caf,.mp4,.ogg,.opus,audio/*'

const scratchModes: ScratchMode[] = [
  '---', '>', '>>', '<', '<<',
  'FWD', 'FSTP', 'BWD', 'BSTP',
  'BABY', 'IBBY', 'B2BY',
  'XFMR', 'CHRP', '2CHP', 'FLRE',
  'SLCE', 'RLSE',
  'TEAR', '2TER', 'ORBT', 'SCRB',
]

const crossfaderActions: CrossfaderAction[] = [
  'open', 'closed', 'chop', 'chopFront', 'cut2', 'cut3',
]

const crossfaderLabels: Record<CrossfaderAction, string> = {
  open: 'OPEN',
  closed: 'CUT',
  chop: 'CHOP>',
  chopFront: '<CHOP',
  cut2: '2CUT',
  cut3: '3CUT',
}

// Scratch type → envelope name for the AudioWorklet
const scratchEnvelopeMap: Record<ScratchMode, string> = {
  '---': 'silent', '>': 'silent', '>>': 'silent', '<': 'silent', '<<': 'silent',
  'FWD': 'forward', 'FSTP': 'forwardStop', 'BWD': 'backward', 'BSTP': 'backwardStop',
  'BABY': 'baby', 'IBBY': 'inBaby', 'B2BY': 'babyDouble',
  'XFMR': 'transformer', 'CHRP': 'chirp', '2CHP': 'chirpDouble', 'FLRE': 'flare',
  'SLCE': 'slice', 'RLSE': 'release',
  'TEAR': 'tear', '2TER': 'tearDouble', 'ORBT': 'orbit', 'SCRB': 'scribble',
}

// Whether this mode is a scratch gesture (drives speed via envelope)
function isScratchGesture(mode: ScratchMode): boolean {
  return mode !== '---' && mode !== '>' && mode !== '>>' && mode !== '<' && mode !== '<<'
}

// Whether this mode forces a restart from cue
function forcesRestart(mode: ScratchMode): boolean {
  return mode === '>' || mode === '>>' || mode === '<' || mode === '<<'
}

// Whether this mode plays in reverse
function isReverseTrigger(mode: ScratchMode): boolean {
  return mode === '<' || mode === '<<'
}

// Default cue slot for a scratch type
function defaultCueSlot(mode: ScratchMode): CueSlot {
  if (mode === '---' || mode === 'BWD' || mode === 'BSTP' || mode === 'IBBY') return null
  return 'cue1'
}

function mkStep(id: number, mode: ScratchMode, velocity = 1.0, crossfader: CrossfaderAction = 'open', cueSlot?: CueSlot): SequencerStep {
  return { id, mode, velocity, crossfader, cueSlot: cueSlot !== undefined ? cueSlot : defaultCueSlot(mode) }
}

const defaultSteps: SequencerStep[] = [
  mkStep(1, '>'),
  mkStep(2, 'BABY', 1.0),
  mkStep(3, 'IBBY', 0.95),
  mkStep(4, 'B2BY', 0.9),
  mkStep(5, '---', 1, 'closed'),
  mkStep(6, 'BABY', 1.05),
  mkStep(7, 'IBBY', 1.0),
  mkStep(8, 'SLCE', 0.95),
  mkStep(9, '>'),
  mkStep(10, 'B2BY', 0.95),
  mkStep(11, 'BABY', 1.05),
  mkStep(12, 'IBBY', 1.0),
  mkStep(13, '---', 1, 'closed'),
  mkStep(14, 'RLSE', 0.95),
  mkStep(15, 'BABY', 1.0),
  mkStep(16, 'SLCE', 0.88, 'cut2'),
]

const modeLabels: Record<ScratchMode, string> = {
  '---': '---', '>': '>', '>>': '>>', '<': '<', '<<': '<<',
  FWD: 'FWD', FSTP: 'FSTP', BWD: 'BWD', BSTP: 'BSTP',
  BABY: 'BABY', IBBY: 'IBBY', B2BY: 'B2BY',
  XFMR: 'XFMR', CHRP: 'CHRP', '2CHP': '2CHP', FLRE: 'FLRE',
  SLCE: 'SLCE', RLSE: 'RLSE',
  TEAR: 'TEAR', '2TER': '2TER', ORBT: 'ORBT', SCRB: 'SCRB',
}

const modeDescriptions: Record<ScratchMode, string> = {
  '---': '通常のループ再生',
  '>': 'CUEからトリガー',
  '>>': 'CUEからダブルトリガー',
  '<': '逆方向トリガー',
  '<<': '逆方向ダブルトリガー',
  FWD: '前方ストローク',
  FSTP: '前方→停止→前方',
  BWD: '後方ストローク',
  BSTP: '後方→停止→後方',
  BABY: 'ベイビースクラッチ(前→後)',
  IBBY: 'インベイビー(後→前)',
  B2BY: 'ベイビー×2(4分割)',
  XFMR: 'トランスフォーマー',
  CHRP: 'チャープ',
  '2CHP': 'チャープ×2',
  FLRE: 'フレア(1クリック)',
  SLCE: 'スライス',
  RLSE: 'リリース',
  TEAR: 'ティアー',
  '2TER': 'ティアー×2',
  ORBT: 'オービット(2クリック)',
  SCRB: 'スクリブル(高速振動)',
}

const modeClassNames: Record<ScratchMode, string> = {
  '---': 'is-plain', '>': 'is-trigger', '>>': 'is-trigger', '<': 'is-trigger', '<<': 'is-trigger',
  FWD: 'is-forward', FSTP: 'is-forward', BWD: 'is-backward', BSTP: 'is-backward',
  BABY: 'is-baby', IBBY: 'is-baby', B2BY: 'is-baby',
  XFMR: 'is-transformer', CHRP: 'is-chirp', '2CHP': 'is-chirp', FLRE: 'is-flare',
  SLCE: 'is-slice', RLSE: 'is-slice',
  TEAR: 'is-tear', '2TER': 'is-tear', ORBT: 'is-orbit', SCRB: 'is-scribble',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00'
  }

  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function App() {
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorNodeRef = useRef<AudioWorkletNode | null>(null)
  const highPassRef = useRef<BiquadFilterNode | null>(null)
  const lowPassRef = useRef<BiquadFilterNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const enginePromiseRef = useRef<Promise<void> | null>(null)
  const sampleLoadedRef = useRef(false)
  const sampleDurationRef = useRef(0)
  const currentTimeRef = useRef(0)
  const isPlayingRef = useRef(false)
  const baseRateRef = useRef(1)
  const stepIntervalRef = useRef<number | null>(null)
  const volumeRef = useRef(0.78)
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const waveformDataRef = useRef<Float32Array | null>(null)
  const waveformAnimRef = useRef<number>(0)

  const [theme, setTheme] = useState<ThemeMode>('light')
  const [sampleName, setSampleName] = useState('Sample not loaded')
  const [status, setStatus] = useState('Drop a sample to begin')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [, setPlaybackSpeed] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isSequencerRunning, setIsSequencerRunning] = useState(false)
  const [volume, setVolume] = useState(0.78)
  const [filterKnob, setFilterKnob] = useState(0)
  const [compressorAmount] = useState(18)
  const [bpm, setBpm] = useState(86)
  const [subdivision, setSubdivision] = useState<Subdivision>(8)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const swing = 0
  const [cueOne, setCueOne] = useState(0)
  const [cueTwo, setCueTwo] = useState(0)
  const [selectedStepIndex, setSelectedStepIndex] = useState(4)
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [steps, setSteps] = useState(defaultSteps)

  const selectedStep = steps[selectedStepIndex]
  const topImage = theme === 'light'
    ? publicAssetUrl('media/top1.jpeg')
    : publicAssetUrl('media/top2.jpeg')

  useEffect(() => {
    volumeRef.current = volume
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume
    }
  }, [volume])

  // ─── Waveform drawing ──────────────────────────────────────────────
  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current
    const samples = waveformDataRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width * dpr
    const h = rect.height * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    ctx.clearRect(0, 0, w, h)

    if (!samples || samples.length === 0) {
      // Empty state
      ctx.fillStyle = 'rgba(13,18,34,0.08)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(13,18,34,0.25)'
      ctx.font = `${14 * dpr}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('Load a sample to see waveform', w / 2, h / 2)
      return
    }

    const midY = h / 2

    // Draw waveform
    const binCount = Math.min(Math.floor(w), 512)
    const samplesPerBin = samples.length / binCount

    // Background
    ctx.fillStyle = 'rgba(13,18,34,0.04)'
    ctx.fillRect(0, 0, w, h)

    // Center line
    ctx.strokeStyle = 'rgba(13,18,34,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(w, midY)
    ctx.stroke()

    // Waveform bars
    for (let i = 0; i < binCount; i++) {
      const startSample = Math.floor(i * samplesPerBin)
      const endSample = Math.min(Math.floor((i + 1) * samplesPerBin), samples.length)

      let maxVal = 0
      let minVal = 0
      for (let j = startSample; j < endSample; j++) {
        if (samples[j] > maxVal) maxVal = samples[j]
        if (samples[j] < minVal) minVal = samples[j]
      }

      const x = (i / binCount) * w
      const barW = Math.max(w / binCount - 0.5, 1)
      const topY = midY - maxVal * midY * 0.9
      const botY = midY - minVal * midY * 0.9
      const barH = Math.max(botY - topY, 1)

      // Color based on position relative to cues
      const normPos = i / binCount
      const cue1Norm = sampleDurationRef.current > 0 ? cueOne / sampleDurationRef.current : 0
      const cue2Norm = sampleDurationRef.current > 0 ? cueTwo / sampleDurationRef.current : 0

      if (Math.abs(normPos - cue1Norm) < 2 / binCount) {
        ctx.fillStyle = 'rgba(255,180,0,0.9)'
      } else if (Math.abs(normPos - cue2Norm) < 2 / binCount) {
        ctx.fillStyle = 'rgba(255,60,90,0.9)'
      } else {
        ctx.fillStyle = 'rgba(50,80,180,0.55)'
      }

      ctx.fillRect(x, topY, barW, barH)
    }

    // Playhead
    if (sampleDurationRef.current > 0) {
      const playheadX = (currentTimeRef.current / sampleDurationRef.current) * w
      ctx.fillStyle = 'rgba(255,60,90,0.85)'
      ctx.fillRect(playheadX - 1 * dpr, 0, 2 * dpr, h)
    }
  }, [cueOne, cueTwo])

  // Animation loop for waveform playhead
  useEffect(() => {
    let running = true
    function tick() {
      if (!running) return
      drawWaveform()
      waveformAnimRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      running = false
      cancelAnimationFrame(waveformAnimRef.current)
    }
  }, [drawWaveform])

  useEffect(() => {
    if (!highPassRef.current || !lowPassRef.current) {
      return
    }

    if (filterKnob < 0) {
      highPassRef.current.frequency.value = 20 + Math.abs(filterKnob) * 4980
      lowPassRef.current.frequency.value = 20000
    } else if (filterKnob > 0) {
      highPassRef.current.frequency.value = 20
      lowPassRef.current.frequency.value = 20000 - filterKnob * 19500
    } else {
      highPassRef.current.frequency.value = 20
      lowPassRef.current.frequency.value = 20000
    }
  }, [filterKnob])

  useEffect(() => {
    if (!compressorRef.current) {
      return
    }

    const normalized = compressorAmount / 100
    compressorRef.current.threshold.value = -8 - normalized * 24
    compressorRef.current.ratio.value = 1 + normalized * 10
    compressorRef.current.knee.value = 28 - normalized * 12
    compressorRef.current.attack.value = 0.002 + normalized * 0.012
    compressorRef.current.release.value = 0.14 + normalized * 0.22
  }, [compressorAmount])

  useEffect(() => {
    if (!isSequencerRunning) {
      if (stepIntervalRef.current !== null) {
        window.clearTimeout(stepIntervalRef.current)
        stepIntervalRef.current = null
      }

      setCurrentStepIndex(-1)
      postToProcessor({ type: 'stopEnvelope' })
      // Stop deck playback when sequencer stops
      setTransportState(false, 1)
      return
    }

    const baseInterval = 60000 / bpm / (subdivision / 4)
    let currentIdx = -1
    let cancelled = false

    function scheduleNext() {
      if (cancelled) return
      currentIdx = (currentIdx + 1) % steps.length
      const idx = currentIdx
      const stepDuration = swungStepDuration(idx, baseInterval, swing)

      setCurrentStepIndex(idx)
      void triggerStep(steps[idx], stepDuration, swing)

      stepIntervalRef.current = window.setTimeout(scheduleNext, stepDuration)
    }

    scheduleNext()

    return () => {
      cancelled = true
      if (stepIntervalRef.current !== null) {
        window.clearTimeout(stepIntervalRef.current)
        stepIntervalRef.current = null
      }
    }
  }, [bpm, isSequencerRunning, steps, subdivision, swing])

  useEffect(() => {
    return () => {
      if (stepIntervalRef.current !== null) {
        window.clearTimeout(stepIntervalRef.current)
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [])

  async function ensureEngine() {
    if (enginePromiseRef.current) {
      await enginePromiseRef.current
      return
    }

    enginePromiseRef.current = (async () => {
      const context = new AudioContext({
        latencyHint: 'interactive',
      })

      await context.audioWorklet.addModule(publicAssetUrl('scratch-processor.js'))

      const processor = new AudioWorkletNode(context, 'scratch-worklet', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })

      const highPass = context.createBiquadFilter()
      const lowPass = context.createBiquadFilter()
      const compressor = context.createDynamicsCompressor()
      const gainNode = context.createGain()

      highPass.type = 'highpass'
      highPass.frequency.value = 20

      lowPass.type = 'lowpass'
      lowPass.frequency.value = 20000

      gainNode.gain.value = volumeRef.current

      processor.connect(highPass)
      highPass.connect(lowPass)
      lowPass.connect(compressor)
      compressor.connect(gainNode)
      gainNode.connect(context.destination)

      processor.port.onmessage = (event: MessageEvent<ProcessorPositionMessage>) => {
        if (event.data.type !== 'position') {
          return
        }

        currentTimeRef.current = event.data.currentTime
        setCurrentTime(event.data.currentTime)
        setPlaybackSpeed(event.data.speed)
      }

      audioContextRef.current = context
      processorNodeRef.current = processor
      highPassRef.current = highPass
      lowPassRef.current = lowPass
      compressorRef.current = compressor
      gainNodeRef.current = gainNode
    })()

    try {
      await enginePromiseRef.current
    } catch (error) {
      enginePromiseRef.current = null
      throw error
    }
  }

  async function resumeEngine() {
    await ensureEngine()

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume()
    }
  }

  function postToProcessor(message: Record<string, unknown>) {
    processorNodeRef.current?.port.postMessage(message)
  }

  function seekToTime(nextTime: number) {
    const safeTime = clamp(nextTime, 0, sampleDurationRef.current)
    currentTimeRef.current = safeTime
    setCurrentTime(safeTime)
    postToProcessor({ type: 'setPosition', time: safeTime })
  }

  function setTransportState(playing: boolean, speed = 1) {
    isPlayingRef.current = playing
    baseRateRef.current = speed
    setIsPlaying(playing)
    postToProcessor({
      type: 'setTransport',
      playing,
      speed,
    })
  }

  function setScratchState(active: boolean, velocity = 0) {
    postToProcessor({
      type: 'setScratch',
      active,
      velocity,
    })
  }

  /** Compute swung step duration for a given step index */
  function swungStepDuration(index: number, baseInterval: number, swingAmount: number): number {
    if (swingAmount <= 0) return baseInterval
    const offset = (swingAmount / 100) * (1 / 3)
    return index % 2 === 0 ? baseInterval * (1 + offset) : baseInterval * (1 - offset)
  }

  async function decodeMonoSample(file: File) {
    await ensureEngine()

    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer.slice(0))
    const mono = new Float32Array(audioBuffer.length)

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const data = audioBuffer.getChannelData(channel)
      for (let index = 0; index < audioBuffer.length; index += 1) {
        mono[index] += data[index] / audioBuffer.numberOfChannels
      }
    }

    return {
      samples: mono,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
    }
  }

  async function triggerStep(step: SequencerStep, durationMs: number, swingAmount: number) {
    if (!sampleLoadedRef.current) {
      return
    }

    await resumeEngine()

    const velocity = clamp(step.velocity, 0.3, 2)
    const envelope = scratchEnvelopeMap[step.mode]
    const scratch = isScratchGesture(step.mode)
    const cueTime = step.cueSlot === 'cue2' ? cueTwo : step.cueSlot === 'cue1' ? cueOne : undefined

    // For trigger types, also determine seek and transport speed
    let seekTime: number | undefined = undefined
    let transportSpeed = velocity

    if (forcesRestart(step.mode) && cueTime !== undefined) {
      seekTime = cueTime
    } else if (step.cueSlot && cueTime !== undefined) {
      seekTime = cueTime
    }

    if (isReverseTrigger(step.mode)) {
      transportSpeed = -velocity
    }

    // Send everything to the AudioWorklet
    postToProcessor({
      type: 'triggerStep',
      envelope,
      velocity,
      crossfader: step.crossfader,
      swing: swingAmount,
      durationMs,
      isScratch: scratch,
      seekTime,
    })

    // Keep transport state in sync for UI
    setTransportState(true, scratch ? 1 : transportSpeed)
  }

  async function togglePlayback() {
    if (!sampleLoadedRef.current) {
      setStatus('Load a sample first')
      return
    }

    await resumeEngine()

    if (isPlayingRef.current) {
      setTransportState(false, 1)
      setStatus('Stopped')
    } else {
      setTransportState(true, 1)
      setStatus(isSequencerRunning ? 'Sequencer running' : 'Playing')
    }
  }

  function stopEverything() {
    if (!sampleLoadedRef.current) {
      return
    }

    postToProcessor({ type: 'stopEnvelope' })
    setScratchState(false, 0)
    setTransportState(false, 1)
    seekToTime(cueOne)
    setPlaybackSpeed(0)
    setIsSequencerRunning(false)
    setStatus('Stopped and returned to CUE 1')
  }

  async function loadAudioFile(file: File) {
    try {
      setStatus(`Decoding ${file.name}...`)
      const decoded = await decodeMonoSample(file)

      sampleLoadedRef.current = true
      sampleDurationRef.current = decoded.duration
      currentTimeRef.current = 0
      isPlayingRef.current = false
      waveformDataRef.current = decoded.samples

      postToProcessor({
        type: 'setBuffer',
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
      })

      setSampleName(file.name)
      setDuration(decoded.duration)
      setCurrentTime(0)
      setPlaybackSpeed(0)
      setCueOne(0)
      setCueTwo(0)
      setIsPlaying(false)
      setIsSequencerRunning(false)
      setStatus(`Loaded ${file.name}`)
    } catch (error) {
      sampleLoadedRef.current = false
      if (error instanceof Error) {
        setStatus(`Audio load failed: ${error.message}`)
      } else {
        setStatus('Audio load failed')
      }
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    await loadAudioFile(file)
    event.target.value = ''
  }

  function handleWaveformDrop(event: React.DragEvent) {
    event.preventDefault()
    setIsDraggingFile(false)
    const file = event.dataTransfer.files?.[0]
    if (file && file.type.startsWith('audio/')) {
      void loadAudioFile(file)
    } else {
      setStatus('Please drop an audio file')
    }
  }

  function captureCue(slot: 1 | 2) {
    if (!sampleLoadedRef.current) {
      return
    }

    const position = currentTimeRef.current

    if (slot === 1) {
      setCueOne(position)
      setStatus(`CUE 1 set at ${formatTime(position)}`)
    } else {
      setCueTwo(position)
      setStatus(`CUE 2 set at ${formatTime(position)}`)
    }
  }


  function updateStep(patch: Partial<SequencerStep>) {
    setSteps((previous) =>
      previous.map((step, index) =>
        index === selectedStepIndex
          ? {
              ...step,
              ...patch,
            }
          : step,
      ),
    )
  }

  async function toggleSequencer() {
    if (!sampleLoadedRef.current) {
      setStatus('Load a sample before running the sequencer')
      return
    }

    await resumeEngine()
    setIsSequencerRunning((previous) => {
      const next = !previous

      if (!next) {
        setStatus('Sequencer stopped')
      } else {
        setStatus('Sequencer armed')
      }

      return next
    })
  }

  return (
    <main className={`app-shell ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <section className="masthead" style={{ backgroundImage: `url(${topImage})` }}>
        <div className="masthead__overlay" />
        <div className="masthead__inner">
          <div>
            <p className="eyebrow">AutoScratch Web Prototype</p>
            <h1>Browser deck for scratch sketches</h1>
            <p className="lede">
              盤の前後移動に追従する専用エンジンへ変えて、逆回転、慣性、
              低速時の擦れ感までブラウザ内で再現する版です。
            </p>
          </div>

          <div className="masthead__controls">
            <label className="pill-upload">
              <input type="file" accept={AUDIO_FILE_ACCEPT} onChange={handleFileChange} />
              <span>Load Sample</span>
            </label>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme((previous) => (previous === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? 'Night Deck' : 'Day Deck'}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="deck-panel">
          <div className="deck-panel__header">
            <div>
              <p className="panel-kicker">Deck</p>
              <h2>{sampleName}</h2>
            </div>
            <p className="status-badge">{status}</p>
          </div>

          {/* Waveform display + drop zone */}
          <div
            className={`waveform-container ${isDraggingFile ? 'is-dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDraggingFile(true) }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={handleWaveformDrop}
          >
            <canvas
              ref={waveformCanvasRef}
              className="waveform-canvas"
              onClick={(e) => {
                if (!sampleLoadedRef.current || sampleDurationRef.current <= 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = (e.clientX - rect.left) / rect.width
                seekToTime(x * sampleDurationRef.current)
              }}
            />
            <div className="waveform-drop-hint">Drop audio file here</div>
            <div className="waveform-labels">
              <span>0:00</span>
              <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="deck-controls-row">
            <div className="transport-card">
              <button className="transport-button transport-button--play" type="button" onClick={() => void togglePlayback()}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button className="transport-button transport-button--stop" type="button" onClick={stopEverything}>
                Stop
              </button>
            </div>

            <div className="cue-buttons">
              <button className="action-pill action-pill--yellow" type="button" onClick={() => captureCue(1)}>
                Set Cue 1
              </button>
              <button className="action-pill action-pill--red" type="button" onClick={() => captureCue(2)}>
                Set Cue 2
              </button>
            </div>

            <div className="control-stack control-stack--inline">
              <label className="slider-block">
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="1.4"
                  step="0.01"
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
                <strong>{volume.toFixed(2)}</strong>
              </label>

              <label className="slider-block">
                <span>Filter</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={filterKnob}
                  onChange={(event) => setFilterKnob(Number(event.target.value))}
                />
                <strong>{filterKnob.toFixed(2)}</strong>
              </label>
            </div>
          </div>
        </div>

        <div className="sequencer-panel">
          <div className="sequencer-topbar">
            <label className="tiny-select">
              <span>BPM</span>
              <input
                type="number"
                min="60"
                max="180"
                value={bpm}
                onChange={(event) => setBpm(clamp(Number(event.target.value) || 60, 60, 180))}
              />
            </label>

            <div className="subdivision-switch">
              {[4, 8, 16].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={subdivision === value ? 'is-active' : ''}
                  onClick={() => setSubdivision(value as Subdivision)}
                >
                  1/{value}
                </button>
              ))}
            </div>

            <button
              className={`run-button ${isSequencerRunning ? 'is-running' : ''}`}
              type="button"
              onClick={() => void toggleSequencer()}
            >
              {isSequencerRunning ? 'Stop Seq' : 'Run Seq'}
            </button>
          </div>

          <div className="step-grid">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className={[
                  'step-tile',
                  modeClassNames[step.mode],
                  selectedStepIndex === index ? 'is-selected' : '',
                  currentStepIndex === index ? 'is-current' : '',
                  step.crossfader !== 'open' ? 'is-accent' : '',
                ].join(' ')}
                onClick={() => setSelectedStepIndex(index)}
              >
                <span className="step-index">{step.id}</span>
                <span className="step-mode">{modeLabels[step.mode]}</span>
                <span className="step-velocity">{step.velocity.toFixed(1)}</span>
              </button>
            ))}
          </div>

          <div className="editor-card">
            <div className="editor-header">
              <div>
                <p className="panel-kicker">Step Editor</p>
                <h3>Step {selectedStep.id}</h3>
              </div>
              <p>{modeDescriptions[selectedStep.mode]}</p>
            </div>

            <div className="mode-pills">
              {scratchModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={[
                    'mode-pill',
                    modeClassNames[mode],
                    selectedStep.mode === mode ? 'is-selected' : '',
                  ].join(' ')}
                  onClick={() => updateStep({ mode, cueSlot: defaultCueSlot(mode) })}
                >
                  {modeLabels[mode]}
                </button>
              ))}
            </div>

            <div className="editor-controls">
              <label className="slider-block slider-block--editor">
                <span>Velocity</span>
                <input
                  type="range"
                  min="0.3"
                  max="2"
                  step="0.1"
                  value={selectedStep.velocity}
                  onChange={(event) =>
                    updateStep({
                      velocity: Number(event.target.value),
                    })
                  }
                />
                <strong>{selectedStep.velocity.toFixed(1)}</strong>
              </label>

              <div className="crossfader-pills">
                <span className="editor-label">Crossfader</span>
                <div className="pill-row">
                  {crossfaderActions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={`xf-pill ${selectedStep.crossfader === action ? 'is-selected' : ''}`}
                      onClick={() => updateStep({ crossfader: action })}
                    >
                      {crossfaderLabels[action]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cue-pills">
                <span className="editor-label">Cue Reset</span>
                <div className="pill-row">
                  {([null, 'cue1', 'cue2'] as CueSlot[]).map((slot) => (
                    <button
                      key={slot ?? 'none'}
                      type="button"
                      className={`xf-pill ${selectedStep.cueSlot === slot ? 'is-selected' : ''}`}
                      onClick={() => updateStep({ cueSlot: slot })}
                    >
                      {slot === null ? 'OFF' : slot === 'cue1' ? 'CUE 1' : 'CUE 2'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
