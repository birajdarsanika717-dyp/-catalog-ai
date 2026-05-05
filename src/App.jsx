import { useState, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import './App.css'

const GROQ_API_KEY = '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'
const PLATFORMS = ['Amazon', 'Meesho', 'Shopify', 'Flipkart']

function BeforeAfterSlider({ before, after }) {
  const [pos, setPos] = useState(50)
  const containerRef = useRef(null)
  const handleMove = useCallback((e) => {
    const rect = containerRef.current.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])
  return (
    <div ref={containerRef} className="slider-container" onMouseMove={handleMove} onTouchMove={handleMove}>
      <img src={before} alt="Before" className="slider-img" />
      <div className="slider-after" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={after} alt="After" className="slider-img" />
      </div>
      <div className="slider-handle" style={{ left: `${pos}%` }}>
        <div className="slider-line" />
        <div className="slider-knob">◀▶</div>
      </div>
      <span className="slider-label left">Before</span>
      <span className="slider-label right">After</span>
    </div>
  )
}

export default function App() {
  const [skus, setSkus] = useState([])
  const [removeBgKey, setRemoveBgKey] = useState('')
  const [platform, setPlatform] = useState('Amazon')
  const [isRunning, setIsRunning] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [showLanding, setShowLanding] = useState(true)

  const addSKU = () => setSkus(prev => [...prev, {
    id: Date.now(), name: '', category: '', price: '',
    imageFile: null, imagePreview: null, status: 'idle',
    title: '', bullets: [], keywords: [], enhancedImage: null, error: ''
  }])

  const updateSKU = (i, field, value) => setSkus(prev => {
    const u = [...prev]; u[i] = { ...u[i], [field]: value }; return u
  })

  const removeSKU = (i) => setSkus(prev => prev.filter((_, idx) => idx !== i))

  const handleImageUpload = (i, file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => { updateSKU(i, 'imageFile', file); updateSKU(i, 'imagePreview', e.target.result) }
    reader.readAsDataURL(file)
  }

  const removeBackground = async (imageFile) => {
    if (!removeBgKey || !imageFile) return null
    try {
      const formData = new FormData()
      formData.append('image_file', imageFile)
      formData.append('size', 'auto')
      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST', headers: { 'X-Api-Key': removeBgKey }, body: formData
      })
      if (!res.ok) return null
      const blob = await res.blob()
      return new Promise((resolve) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1000; canvas.height = 1000
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 1000, 1000)
        const img = new Image()
        const url = URL.createObjectURL(blob)
        img.onload = () => {
          const scale = Math.min(900 / img.width, 900 / img.height)
          ctx.drawImage(img, (1000 - img.width * scale) / 2, (1000 - img.height * scale) / 2, img.width * scale, img.height * scale)
          resolve(canvas.toDataURL('image/jpeg', 0.92)); URL.revokeObjectURL(url)
        }
        img.src = url
      })
    } catch { return null }
  }

  const generateContent = async (sku) => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', max_tokens: 1000,
        messages: [
          { role: 'system', content: 'You are an expert e-commerce copywriter for Indian markets. Always respond with valid JSON only, no markdown, no backticks.' },
          { role: 'user', content: `Generate a ${platform} product listing:
Product: ${sku.name}
Category: ${sku.category}
Price: ₹${sku.price}

Respond ONLY with this JSON (no extra text):
{"title":"SEO-optimized title under 200 chars","bullets":["feature 1","feature 2","feature 3","feature 4","feature 5"],"keywords":["kw1","kw2","kw3","kw4","kw5"]}` }
        ]
      })
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `Error ${res.status}`) }
    const data = await res.json()
    let text = data.choices[0].message.content.trim()
    text = text.replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  }

  const processAll = async () => {
    const idle = skus.filter(s => s.status === 'idle' && s.name)
    if (!idle.length) { alert('Add at least one product with a name.'); return }
    setIsRunning(true); setDoneCount(0); let done = 0
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i]
      if (sku.status !== 'idle' || !sku.name) continue
      setSkus(prev => { const u = [...prev]; u[i] = { ...u[i], status: 'processing' }; return u })
      try {
        const [content, enhanced] = await Promise.all([generateContent(sku), removeBackground(sku.imageFile)])
        done++; setDoneCount(done)
        setSkus(prev => { const u = [...prev]; u[i] = { ...u[i], status: 'done', ...content, enhancedImage: enhanced }; return u })
      } catch (err) {
        setSkus(prev => { const u = [...prev]; u[i] = { ...u[i], status: 'error', error: err.message }; return u })
      }
    }
    setIsRunning(false)
  }

  const exportCSV = () => {
    const done = skus.filter(s => s.status === 'done')
    if (!done.length) { alert('Generate listings first!'); return }
    const rows = done.map(s => ({
      'Product Name': s.name, 'Category': s.category, 'Price (INR)': s.price, 'Platform': platform,
      'Title': s.title, 'Bullet 1': s.bullets[0]||'', 'Bullet 2': s.bullets[1]||'',
      'Bullet 3': s.bullets[2]||'', 'Bullet 4': s.bullets[3]||'', 'Bullet 5': s.bullets[4]||'',
      'Keywords': s.keywords?.join(', ')||''
    }))
    const blob = new Blob([Papa.unparse(rows)], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `catalog-${platform.toLowerCase()}-${Date.now()}.csv`; a.click()
  }

  const totalIdle = skus.filter(s => s.status === 'idle' && s.name).length
  const totalDone = skus.filter(s => s.status === 'done').length
  const totalProcessing = skus.filter(s => s.status === 'processing').length

  if (showLanding) return (
    <div className="landing">
      <div className="landing-bg">
        <div className="orb orb1" /><div className="orb orb2" /><div className="orb orb3" />
      </div>
      <nav className="land-nav">
        <div className="land-logo"><span className="bolt">⚡</span> CatalogAI</div>
        <button className="nav-cta" onClick={() => setShowLanding(false)}>Launch App →</button>
      </nav>
      <div className="hero">
        <div className="hero-badge">🏭 Built for Indian Manufacturers</div>
        <h1 className="hero-title">
          Turn warehouse photos<br />
          into <span className="gradient-text">Amazon listings</span><br />
          in one click.
        </h1>
        <p className="hero-sub">
          Upload blurry factory photos + product details → Get studio-quality listings with SEO titles, bullet points & keywords. Export to Amazon, Meesho, Shopify instantly.
        </p>
        <div className="hero-btns">
          <button className="btn-hero-primary" onClick={() => setShowLanding(false)}>
            Start Building Catalog →
          </button>
        </div>
        <div className="hero-stats">
          <div className="stat-item"><span className="stat-num">200+</span><span className="stat-label">SKUs per batch</span></div>
          <div className="stat-divider" />
          <div className="stat-item"><span className="stat-num">3 sec</span><span className="stat-label">per listing</span></div>
          <div className="stat-divider" />
          <div className="stat-item"><span className="stat-num">₹0</span><span className="stat-label">vs ₹5000 manual cost</span></div>
        </div>
      </div>
      <div className="features">
        <div className="feat-card">
          <div className="feat-icon">🤖</div>
          <div className="feat-title">AI Copywriting</div>
          <div className="feat-desc">Platform-specific SEO titles, 5 bullet points & keywords generated instantly</div>
        </div>
        <div className="feat-card">
          <div className="feat-icon">🖼️</div>
          <div className="feat-title">Image Enhancement</div>
          <div className="feat-desc">Remove backgrounds, apply studio-white finish, resize to platform standards</div>
        </div>
        <div className="feat-card">
          <div className="feat-icon">📦</div>
          <div className="feat-title">Bulk Export</div>
          <div className="feat-desc">Download Amazon flat-file CSV ready to upload. No copy-paste, no manual work</div>
        </div>
        <div className="feat-card">
          <div className="feat-icon">🛒</div>
          <div className="feat-title">Multi-Platform</div>
          <div className="feat-desc">Amazon, Meesho, Shopify & Flipkart — each with platform-specific formatting</div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo" onClick={() => setShowLanding(true)} style={{cursor:'pointer'}}>
            <span className="bolt">⚡</span>
            <div>
              <div className="logo-title">CatalogAI</div>
              <div className="logo-sub">Factory dump → ready listing</div>
            </div>
          </div>
          <div className="header-actions">
            <select className="platform-select" value={platform} onChange={e => setPlatform(e.target.value)}>
              {PLATFORMS.map(p => <option key={p}>{p}</option>)}
            </select>
            <input
              className="removebg-input"
              type="password"
              placeholder="Remove.bg key (optional)"
              value={removeBgKey}
              onChange={e => setRemoveBgKey(e.target.value)}
              title="Add Remove.bg API key to enable image background removal"
            />
          </div>
        </div>
        {isRunning && (
          <div className="progress-wrap">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(doneCount / (totalIdle + doneCount || 1)) * 100}%` }} />
            </div>
            <span className="progress-text">Processing… {doneCount} done</span>
          </div>
        )}
      </header>

      <main className="main">
        <div className="sku-list">
          {skus.map((sku, i) => (
            <div key={sku.id} className={`sku-card ${sku.status}`}>
              <div className="sku-header">
                <span className="sku-num">SKU {String(i+1).padStart(2,'0')}</span>
                <span className={`sku-badge ${sku.status}`}>
                  {sku.status === 'processing' && <span className="spinner" />}
                  {sku.status === 'idle' ? 'Ready' : sku.status === 'processing' ? 'Processing…' : sku.status === 'done' ? '✓ Done' : '✗ Failed'}
                </span>
                {sku.status === 'idle' && <button className="del-btn" onClick={() => removeSKU(i)}>✕</button>}
              </div>

              {sku.status === 'idle' && (
                <div className="sku-form">
                  <div className="img-upload" onClick={() => {
                    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'
                    inp.onchange = e => handleImageUpload(i, e.target.files[0]); inp.click()
                  }}>
                    {sku.imagePreview
                      ? <img src={sku.imagePreview} alt="" className="img-preview" />
                      : <div className="img-placeholder"><span>📷</span><span>Upload photo</span></div>}
                  </div>
                  <div className="form-fields">
                    <input className="finput" placeholder="Product name *" value={sku.name} onChange={e => updateSKU(i, 'name', e.target.value)} />
                    <input className="finput" placeholder="Category (e.g. Men's shoes)" value={sku.category} onChange={e => updateSKU(i, 'category', e.target.value)} />
                    <input className="finput" placeholder="Price (₹)" type="number" value={sku.price} onChange={e => updateSKU(i, 'price', e.target.value)} />
                  </div>
                </div>
              )}

              {sku.status === 'processing' && (
                <div className="processing-state">
                  <div className="processing-bar"><div className="processing-fill" /></div>
                  <p>AI is writing your listing…</p>
                </div>
              )}

              {sku.status === 'done' && (
                <div className="sku-result">
                  {sku.enhancedImage && <BeforeAfterSlider before={sku.imagePreview} after={sku.enhancedImage} />}
                  {sku.imagePreview && !sku.enhancedImage && (
                    <img src={sku.imagePreview} alt="product" className="result-img" />
                  )}
                  <div className="result-content">
                    <div className="result-title">{sku.title}</div>
                    <ul className="result-bullets">
                      {sku.bullets?.map((b, j) => <li key={j}><span className="bullet-dot">✦</span>{b}</li>)}
                    </ul>
                    <div className="result-keywords">
                      {sku.keywords?.map((k, j) => <span key={j} className="kw-tag">{k}</span>)}
                    </div>
                  </div>
                </div>
              )}

              {sku.status === 'error' && (
                <div className="error-state">⚠ {sku.error}<br/><small>Check your product name and try again.</small></div>
              )}
            </div>
          ))}
        </div>

        <button className="add-btn" onClick={addSKU}>+ Add Product</button>

        {skus.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🏭</div>
            <h2>Ready to build your catalog</h2>
            <p>Add your first product and let AI do the rest</p>
            <button className="btn-start" onClick={addSKU}>+ Add first product</button>
          </div>
        )}
      </main>

      {skus.length > 0 && (
        <footer className="action-bar">
          <div className="bar-stats">
            {totalIdle > 0 && <span className="pill idle">{totalIdle} queued</span>}
            {totalProcessing > 0 && <span className="pill proc">{totalProcessing} running</span>}
            {totalDone > 0 && <span className="pill done">{totalDone} done</span>}
          </div>
          <div className="bar-btns">
            {totalDone > 0 && <button className="btn-export" onClick={exportCSV}>↓ Export CSV</button>}
            <button className="btn-generate" onClick={processAll} disabled={isRunning || !totalIdle}>
              {isRunning ? `Processing…` : `⚡ Generate ${totalIdle} listing${totalIdle !== 1 ? 's' : ''}`}
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
