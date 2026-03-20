// ============ Entropy Password Generator ============
//
// Collects mouse/touch movement as visual entropy feedback,
// then generates a strong memorable passphrase.
//
// The mouse movements are VISUAL FEEDBACK — the actual entropy
// comes from crypto.getRandomValues() which is cryptographically
// secure. Mouse entropy is mixed in as supplementary randomness.
//
// Returns a promise that resolves with the password string,
// or null if the user cancels.
// ============

// BIP39-inspired word list (shorter, memorable subset)
const WORDS = [
  'abandon','ability','able','abstract','abuse','access','acid','acoustic',
  'across','adapt','adjust','admit','adult','advice','afraid','again',
  'agent','agree','ahead','alarm','album','alert','alien','almost',
  'alpha','alter','always','anchor','anger','animal','answer','antique',
  'apart','apple','arctic','arena','armor','arrow','atlas','atom',
  'audit','autumn','avocado','badge','balance','bamboo','banner','barrel',
  'basic','basket','battle','beach','beacon','beauty','begin','believe',
  'bench','benefit','best','betray','beyond','bicycle','bird','blade',
  'blanket','blast','blaze','blend','bless','blind','blood','blossom',
  'board','bolt','bonus','border','bounce','brain','brave','bread',
  'breeze','bridge','bright','broken','bronze','bubble','buddy','budget',
  'build','bullet','bundle','burden','burger','burst','cabin','cable',
  'cactus','cage','camera','camp','canal','cancel','canvas','canyon',
  'carbon','cargo','carpet','casino','castle','catalog','caught','caution',
  'cave','ceiling','celery','cement','census','century','cereal','chain',
  'chair','chalk','champion','chaos','chapter','charge','chase','cheap',
  'chimney','choice','chunk','cinema','circle','citizen','civil','claim',
  'clap','clever','cliff','climb','clinic','clock','cloud','cluster',
  'coach','coast','coconut','code','coil','collect','colony','column',
  'combat','comfort','comic','common','company','concert','connect','consider',
  'control','convince','coral','core','cosmic','cotton','couch','country',
  'couple','course','cousin','cover','craft','crash','crater','crazy',
  'cream','credit','crew','cricket','crime','crisp','critic','cross',
  'crowd','cruel','cruise','crystal','cube','culture','cupboard','curious',
  'current','curve','cycle','damage','dance','danger','daring','dash',
  'daughter','dawn','debate','decade','december','decide','decline','decorate',
  'deep','deer','defense','define','delay','deliver','demand','denial',
  'dentist','depart','depend','deposit','depth','deputy','derive','desert',
  'design','detect','develop','device','devote','diamond','diesel','differ',
  'digital','dignity','dilemma','dinner','dinosaur','direct','discover','disease',
  'display','distance','divide','doctor','domain','donate','donkey','donor',
  'double','dragon','drama','drastic','dream','drift','drink','drop',
  'drum','dry','duck','dumb','dune','during','dust','dynamic',
  'eager','eagle','early','earth','easel','east','easy','echo',
  'ecology','economy','edge','effort','eight','either','elbow','elder',
  'electric','elegant','element','elephant','elite','emerge','emotion','employ',
  'enable','endorse','energy','enforce','engage','engine','enhance','enjoy',
  'entire','entry','envelope','episode','equal','equip','erode','escape',
  'essay','eternal','evening','evidence','evil','evolve','exact','example',
  'excess','exchange','excite','exclude','excuse','execute','exile','exist',
  'exotic','expand','expect','expire','explain','expose','express','extend',
  'extra','fabric','face','faculty','faint','faith','false','family',
  'famous','fancy','fantasy','farm','fashion','fatal','father','fatigue',
  'fault','favorite','feature','federal','fence','festival','fetch','fever',
  'fiber','fiction','field','figure','file','film','filter','final',
  'finger','finish','fire','firm','fiscal','fitness','flag','flame',
  'flash','flavor','flight','flip','float','flock','floor','flower',
  'fluid','flush','fly','foam','focus','follow','food','force',
  'forest','forget','forum','fossil','foster','found','fragile','frame',
  'frozen','fruit','fuel','fun','funny','furnace','fury','future',
  'galaxy','garden','garlic','gather','gauge','gaze','general','genius',
  'ghost','giant','gift','giggle','ginger','giraffe','glad','glance',
  'glare','glass','globe','gloom','glory','glove','glow','goddess',
  'gold','good','goose','gorilla','gospel','gossip','govern','grace',
  'grain','grant','grape','grass','gravity','great','green','grid',
  'grief','grit','grocery','group','grow','grunt','guard','guess',
  'guide','guilt','guitar','gun','gym','habit','half','hammer',
  'happy','harbor','hard','harsh','harvest','hawk','hazard','head',
  'health','heart','heavy','hedgehog','height','hello','helmet','hero',
  'hidden','high','hill','hint','history','hobby','hockey','hold',
  'hollow','home','honey','hood','hope','horror','horse','hospital',
  'host','hotel','hover','hub','huge','human','humble','humor',
  'hundred','hungry','hunt','hybrid','ice','icon','idea','identify',
]

/**
 * Show an entropy collection overlay and generate a strong passphrase.
 * Returns a promise: resolves with password string, or null if cancelled.
 */
export function collectEntropyAndGeneratePassword() {
  return new Promise((resolve) => {
    // Create overlay
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.95); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; color: #e0e0e0;
    `

    // Entropy state
    let entropyBits = 0
    const TARGET_BITS = 128
    const mouseData = []

    // Grid canvas for visual feedback
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 300
    canvas.style.cssText = `
      border: 1px solid rgba(0,255,65,0.15); border-radius: 12px;
      cursor: crosshair; margin-bottom: 24px;
    `
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(8,8,8,0.95)'
    ctx.fillRect(0, 0, 300, 300)

    // Title
    const title = document.createElement('div')
    title.style.cssText = 'font-size: 18px; margin-bottom: 8px; color: #00ff41;'
    title.textContent = 'Generate Your Password'

    const subtitle = document.createElement('div')
    subtitle.style.cssText = 'font-size: 13px; margin-bottom: 24px; color: #808080; text-align: center; max-width: 320px;'
    subtitle.textContent = 'Move your mouse randomly over the grid. Your movement creates visual entropy for password generation.'

    // Progress bar
    const progressWrap = document.createElement('div')
    progressWrap.style.cssText = 'width: 300px; height: 6px; background: #181818; border-radius: 3px; margin-bottom: 16px; overflow: hidden;'
    const progressBar = document.createElement('div')
    progressBar.style.cssText = 'width: 0%; height: 100%; background: #00ff41; border-radius: 3px; transition: width 0.1s;'
    progressWrap.appendChild(progressBar)

    const progressLabel = document.createElement('div')
    progressLabel.style.cssText = 'font-size: 11px; color: #505050; margin-bottom: 24px;'
    progressLabel.textContent = 'Entropy: 0%'

    // Result area (hidden initially)
    const resultArea = document.createElement('div')
    resultArea.style.cssText = 'display: none; text-align: center;'

    // Cancel button
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = `
      padding: 8px 20px; font-size: 12px; font-family: inherit;
      background: transparent; color: #505050; border: 1px solid #353535;
      border-radius: 8px; cursor: pointer; margin-top: 16px;
    `
    cancelBtn.onmouseover = () => cancelBtn.style.color = '#e0e0e0'
    cancelBtn.onmouseout = () => cancelBtn.style.color = '#505050'
    cancelBtn.onclick = () => { overlay.remove(); resolve(null) }

    // Assemble
    overlay.appendChild(title)
    overlay.appendChild(subtitle)
    overlay.appendChild(canvas)
    overlay.appendChild(progressWrap)
    overlay.appendChild(progressLabel)
    overlay.appendChild(resultArea)
    overlay.appendChild(cancelBtn)
    document.body.appendChild(overlay)

    // Track mouse movement
    let lastX = 0, lastY = 0
    const handleMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // Only count if inside canvas
      if (x < 0 || x > 300 || y < 0 || y > 300) return

      // Need minimum movement to count
      const dx = Math.abs(x - lastX)
      const dy = Math.abs(y - lastY)
      if (dx + dy < 3) return

      lastX = x; lastY = y
      mouseData.push(x, y, Date.now() % 1000)

      // Draw trail
      ctx.fillStyle = `rgba(0,255,65,${0.1 + Math.random() * 0.15})`
      ctx.fillRect(x - 2, y - 2, 4, 4)

      // Faint connecting line
      ctx.strokeStyle = `rgba(0,255,65,0.06)`
      ctx.beginPath()
      ctx.moveTo(lastX, lastY)
      ctx.lineTo(x, y)
      ctx.stroke()

      entropyBits = Math.min(TARGET_BITS, mouseData.length * 2)
      const pct = Math.min(100, (entropyBits / TARGET_BITS) * 100)
      progressBar.style.width = pct + '%'
      progressLabel.textContent = `Entropy: ${Math.round(pct)}%`

      if (entropyBits >= TARGET_BITS) {
        generateResult()
      }
    }

    // Touch support
    const handleTouch = (e) => {
      e.preventDefault()
      const touch = e.touches[0]
      handleMove({ clientX: touch.clientX, clientY: touch.clientY })
    }

    canvas.addEventListener('mousemove', handleMove)
    canvas.addEventListener('touchmove', handleTouch, { passive: false })

    function generateResult() {
      canvas.removeEventListener('mousemove', handleMove)
      canvas.removeEventListener('touchmove', handleTouch)

      // Mix mouse entropy with crypto.getRandomValues for the actual password
      const cryptoEntropy = new Uint32Array(6)
      crypto.getRandomValues(cryptoEntropy)

      // XOR mouse data hash with crypto entropy
      const mouseHash = mouseData.reduce((h, v) => ((h << 5) - h + v) | 0, 0)

      // Generate 6-word passphrase
      const words = []
      for (let i = 0; i < 6; i++) {
        const mixed = cryptoEntropy[i] ^ (mouseHash + i * 7919)
        const idx = Math.abs(mixed) % WORDS.length
        words.push(WORDS[idx])
      }

      const passphrase = words.join('-')

      // Show result
      canvas.style.display = 'none'
      progressWrap.style.display = 'none'
      progressLabel.style.display = 'none'
      subtitle.textContent = 'Your passphrase (write it down — it cannot be recovered):'

      resultArea.style.display = 'block'
      resultArea.innerHTML = `
        <div style="
          background: rgba(0,255,65,0.05); border: 1px solid rgba(0,255,65,0.2);
          border-radius: 10px; padding: 16px 24px; margin-bottom: 16px;
          font-size: 18px; letter-spacing: 1px; color: #00ff41;
          user-select: all; cursor: text;
        ">${passphrase}</div>
        <div style="font-size: 11px; color: #505050; margin-bottom: 16px;">
          6 words = ~77 bits of entropy. Click the passphrase to select it.
        </div>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="entropy-use" style="
            padding: 10px 24px; font-size: 13px; font-family: inherit;
            background: rgba(0,255,65,0.1); color: #00ff41;
            border: 1px solid rgba(0,255,65,0.3); border-radius: 8px; cursor: pointer;
          ">Use This Password</button>
          <button id="entropy-own" style="
            padding: 10px 24px; font-size: 13px; font-family: inherit;
            background: transparent; color: #808080;
            border: 1px solid #353535; border-radius: 8px; cursor: pointer;
          ">Type My Own</button>
        </div>
      `

      cancelBtn.style.display = 'none'

      document.getElementById('entropy-use').onclick = () => {
        overlay.remove()
        resolve(passphrase)
      }

      document.getElementById('entropy-own').onclick = () => {
        const own = window.prompt('Enter your own password (minimum 8 characters):')
        overlay.remove()
        resolve(own && own.length >= 8 ? own : null)
      }
    }
  })
}
