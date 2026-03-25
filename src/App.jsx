import React, { useState, useEffect, useMemo } from 'react';
import { studiesData, categories } from './data';

// Group studies by book
function groupByBook(studies) {
  const groups = {};
  studies.forEach((s, idx) => {
    // Standardize book name extraction
    const match = s.title.match(/^([\wÁÉÍÓÚáéíóúñÑ]+\s?\d*)/);
    const book = match ? match[1].replace(/\s*\d+$/, '').trim() : 'Estudios';
    if (!groups[book]) groups[book] = [];
    groups[book].push({ ...s, globalIndex: idx });
  });
  return groups;
}

function App() {
  const [activeTab, setActiveTab] = useState('studies');
  const [currentChapterIndex, setCurrentChapterIndex] = useState(() => {
    const saved = localStorage.getItem('evangelismoChapter');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [studentName, setStudentName] = useState(() => localStorage.getItem('evangelismoStudent') || '');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [step, setStep] = useState(() => {
    const saved = localStorage.getItem('evangelismoStep');
    return saved ? parseInt(saved, 10) : 0;
  });

  const [answers, setAnswers] = useState(() => {
    try {
      const saved = localStorage.getItem('evangelismoAnswers');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const currentChapter = studiesData[currentChapterIndex];
  const bookGroups = useMemo(() => groupByBook(studiesData), []);

  const allQuestions = useMemo(() => {
    if (!currentChapter) return [];
    const qList = [];

    const sections = [
      { key: 'context', label: 'Contexto', icon: '📜' },
      { key: 'observation', label: 'Observación', icon: '🔍' },
      { key: 'meaning', label: 'Significado', icon: '💡' },
      { key: 'application', label: 'Aplicación', icon: '🙏' },
      { key: 'gospel', label: 'Evangelio', icon: '✝️' }
    ];

    sections.forEach(sec => {
      const data = currentChapter[sec.key];
      if (data && data.items) {
        data.items.forEach((item, i) => {
          qList.push({ 
            id: `${sec.key}_${i}`, 
            label: sec.label, 
            question: item.text, 
            type: sec.key, 
            icon: sec.icon,
            isQuestion: !!item.isQuestion 
          });
        });
      }
    });

    return qList;
  }, [currentChapter]);

  useEffect(() => {
    localStorage.setItem('evangelismoAnswers', JSON.stringify(answers));
  }, [answers]);

  useEffect(() => {
    localStorage.setItem('evangelismoChapter', currentChapterIndex);
    localStorage.setItem('evangelismoStep', step);
  }, [currentChapterIndex, step]);

  useEffect(() => {
    localStorage.setItem('evangelismoStudent', studentName);
  }, [studentName]);

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [`ch${currentChapter.chapter}_${questionId}`]: value
    }));
  };

  const generateReport = () => {
    if (!studentName.trim()) {
      alert("⚠️ Por favor, ingresa tu nombre.");
      return;
    }
    let body = `REPORTE DE ESTUDIO BÍBLICO\n`;
    body += `Capítulo: ${currentChapter.title}\n`;
    body += `Estudiante: ${studentName}\n\n`;
    
    if (currentChapter.centralIdea) {
      body += `[IDEA CENTRAL]\n${currentChapter.centralIdea}\n\n`;
    }
    
    if (currentChapter.keyVerse) {
      body += `[MEMORIZAR]\n${currentChapter.keyVerse}\n\n`;
    }
    
    body += `--- RESPUESTAS ---\n\n`;
    
    allQuestions.forEach((q, idx) => {
      if (q.isQuestion) {
        const ans = answers[`ch${currentChapter.chapter}_${q.id}`] || '(sin responder)';
        body += `${idx + 1}. [${q.label}] ${q.question}\nR: ${ans}\n\n`;
      }
    });
    
    body += `\nGenerado desde la App de Estudios Bíblicos - Hechos de los Apóstoles.`;
    
    const subject = encodeURIComponent(`Reporte Hechos ${currentChapter.chapter}: ${studentName}`);
    window.location.href = `mailto:hermego54@gmail.com?subject=${subject}&body=${encodeURIComponent(body)}`;
  };

  if (!currentChapter) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Cinzel', color: '#8b6914' }}>
        Cargando estudios...
      </div>
    );
  }

  const totalSteps = allQuestions.length + 2;
  const progress = (step / (totalSteps - 1)) * 100;
  const answeredCount = allQuestions.filter(q =>
    answers[`ch${currentChapter.chapter}_${q.id}`]?.trim()
  ).length;

  return (
    <div className="app-container">
      {/* Deploy Verification */}
      <div id="deploy-check-v2" style={{ display: 'none' }}>Correct Version Active</div>

      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Mobile Toggle */}
      <button className="mobile-nav-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <img src="/assets/logo.svg" alt="Estudio Bíblico" className="sidebar-logo" />
          <h2>Estudio Bíblico</h2>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <h3 className="nav-label">Menú</h3>
            <div
              className={`nav-item ${activeTab === 'studies' ? 'active' : ''}`}
              onClick={() => { setActiveTab('studies'); setSidebarOpen(false); }}
            >
              📖 Estudios
            </div>
            <div
              className={`nav-item ${activeTab === 'contact' ? 'active' : ''}`}
              onClick={() => { setActiveTab('contact'); setSidebarOpen(false); }}
            >
              ✉️ Contacto
            </div>
          </div>

          {activeTab === 'studies' && (
            <div className="nav-group">
              <h3 className="nav-label">Planes de Estudio</h3>
              {categories.map(cat => (
                <div key={cat.id} className="nav-category-group">
                  <div className="nav-category-title">
                    {cat.name}
                  </div>
                  {studiesData
                    .map((s, idx) => ({ ...s, globalIndex: idx }))
                    .filter(s => s.chapter >= cat.range[0] && s.chapter <= cat.range[1])
                    .map(ch => (
                      <div
                        key={ch.globalIndex}
                        className={`nav-item ${ch.globalIndex === currentChapterIndex ? 'active' : ''}`}
                        onClick={() => { 
                          setCurrentChapterIndex(ch.globalIndex); 
                          setStep(0);
                          setSidebarOpen(false); 
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <span>Hechos {ch.chapter}</span>
                          {answers[`ch${ch.chapter}_finish`] && <span style={{ fontSize: '0.7rem' }}>✅</span>}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </nav>
      </aside>

      {/* ── MAIN ── */}
      <main className="main-wrapper">
        <div className="progress-bar-container">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>

        <section className="notebook-content">
          {activeTab === 'studies' ? (
            <div className="notebook-page">

              {/* ═══ STEP 0: CHAPTER PRESENTATION ═══ */}
              {step === 0 && (
                <div className="step-container animate-fade">
                  <div style={{ display: 'flex', gap: '3rem', alignItems: 'flex-start', flexWrap: 'wrap', width: '100%' }}>
                    
                    {/* Left Column: Visual & Header */}
                    <div style={{ flex: '1 1 400px' }}>
                      <div className="chapter-header" style={{ marginBottom: '2rem' }}>
                        <span className="chapter-hero-label" style={{ color: 'var(--accent-gold)', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: '800' }}>
                          Hechos · Capítulo {currentChapter.chapter}
                        </span>
                        <h1 className="chapter-title" style={{ fontSize: '2.8rem', marginTop: '0.5rem', fontFamily: 'EB Garamond, serif' }}>
                          {currentChapter.title}
                        </h1>
                      </div>
                      
                      {currentChapter.image && (
                        <div style={{ 
                          borderRadius: '12px', 
                          overflow: 'hidden', 
                          boxShadow: '0 15px 40px rgba(0,0,0,0.12)',
                          border: '1px solid rgba(197, 160, 89, 0.2)',
                          marginBottom: '1.5rem',
                          position: 'relative'
                        }}>
                          <img 
                            src={currentChapter.image} 
                            alt={currentChapter.title} 
                            style={{ width: '100%', height: 'auto', display: 'block', transition: 'transform 0.5s ease' }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          {currentChapter.image === '/assets/hero.png' && (
                            <div style={{ 
                              position: 'absolute', 
                              bottom: '10px', 
                              right: '10px', 
                              background: 'rgba(0,0,0,0.6)', 
                              color: 'white', 
                              padding: '4px 8px', 
                              fontSize: '0.7rem', 
                              borderRadius: '4px',
                              fontFamily: 'Inter, sans-serif'
                            }}>
                              🎨 Pendiente por imagen
                            </div>
                          )}
                        </div>
                      )}

                      {currentChapter.keyVerse && (
                        <div className="memorize-box" style={{ 
                          padding: '1.5rem', 
                          backgroundColor: 'rgba(197, 160, 89, 0.08)',
                          borderLeft: '5px solid var(--accent-gold)', 
                          borderRadius: '4px 16px 16px 4px',
                          boxShadow: '0 4px 15px rgba(197, 160, 89, 0.1)',
                          textAlign: 'left',
                          marginBottom: '2rem'
                        }}>
                          <span style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '0.8rem', fontWeight: '900', color: 'var(--accent-gold-dark)', marginBottom: '0.8rem', letterSpacing: '0.15em' }}>
                            ✨ MEMORIZAR:
                          </span>
                          <p style={{ fontStyle: 'italic', fontSize: '1.15rem', color: 'var(--ink-main)', lineHeight: '1.4', margin: 0, fontWeight: '700' }}>
                            {currentChapter.keyVerse}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Info & Engagement */}
                    <div style={{ flex: '1 1 350px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        
                        <div className="intro-info-section">
                          <span style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '0.7rem', color: 'var(--accent-gold-dark)', marginBottom: '0.5rem', letterSpacing: '0.15em', fontWeight: 'bold' }}>
                            OBJETIVO DE LA SESIÓN
                          </span>
                          <p style={{ fontSize: '1.15rem', color: 'var(--ink-main)', lineHeight: '1.5', margin: 0, opacity: 0.9 }}>
                            {currentChapter.objective}
                          </p>
                        </div>


                        {currentChapter.centralIdea && (
                          <div className="central-idea-box" style={{ 
                            padding: '1.5rem', 
                            backgroundColor: 'rgba(67, 100, 54, 0.05)',
                            borderLeft: '5px solid var(--accent-green)', 
                            borderRadius: '4px 16px 16px 4px',
                            textAlign: 'left'
                          }}>
                            <span style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--accent-green-dark)', marginBottom: '0.6rem', letterSpacing: '0.15em' }}>
                              IDEA CENTRAL:
                            </span>
                            <p style={{ fontSize: '1rem', color: 'var(--ink-main)', lineHeight: '1.5', margin: 0, opacity: 0.9 }}>
                              {currentChapter.centralIdea}
                            </p>
                          </div>
                        )}

                        <div style={{ marginTop: '1rem' }}>
                          <div style={{ 
                            display: 'flex', 
                            justifyContent: 'center', 
                            gap: '3rem', 
                            marginBottom: '1.5rem', 
                            padding: '1.2rem', 
                            backgroundColor: 'rgba(0,0,0,0.03)', 
                            borderRadius: '16px',
                            border: '1px solid rgba(0,0,0,0.05)'
                          }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.6rem', fontWeight: '900', color: 'var(--ink-main)' }}>{allQuestions.length}</div>
                              <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>Pasos</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.6rem', fontWeight: '900', color: 'var(--accent-green)' }}>{answeredCount}</div>
                              <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>Hechos</div>
                            </div>
                          </div>

                          <button 
                            className="btn-primary" 
                            onClick={() => setStep(1)} 
                            style={{ 
                              width: '100%', 
                              padding: '1.2rem', 
                              fontSize: '1.1rem',
                              fontWeight: 'bold',
                              boxShadow: '0 10px 20px rgba(111, 78, 55, 0.2)'
                            }}
                          >
                            Empezar Estudio →
                          </button>
                        </div>

                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* ═══ STEPS 1–N: QUESTIONS ═══ */}
              {step >= 1 && step <= allQuestions.length && (
                <div className="step-container animate-slide" key={`step-${step}`}>
                  <div className="question-step">
                    <div className="question-badge" data-type={allQuestions[step - 1].type}>
                      <span className="badge-icon">{allQuestions[step - 1].icon}</span>
                      <span className="badge-label">{allQuestions[step - 1].label}</span>
                      <span className="question-counter">{step} / {allQuestions.length}</span>
                    </div>

                    <h2 className={`question-text ${!allQuestions[step - 1].isQuestion ? 'info-text' : ''}`}>
                      {allQuestions[step - 1].question}
                    </h2>

                    {allQuestions[step - 1].isQuestion && (
                      <>
                        <label className="entry-label">Respuesta:</label>
                        <textarea
                          className="entry-field"
                          placeholder="Escribe tu reflexión aquí..."
                          value={answers[`ch${currentChapter.chapter}_${allQuestions[step - 1].id}`] || ''}
                          onChange={(e) => handleAnswerChange(allQuestions[step - 1].id, e.target.value)}
                          autoFocus
                        />
                      </>
                    )}
                    {!allQuestions[step - 1].isQuestion && (
                      <div className="info-decoration">
                        <span>✧</span>
                        <p>Reflexión y lectura para el estudio.</p>
                      </div>
                    )}

                    <div className="step-navigation">
                      <button className="btn-secondary" onClick={() => setStep(step - 1)}>
                        ← Anterior
                      </button>
                      <button
                        className="btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => {
                          if (step === allQuestions.length) {
                             setAnswers(prev => ({ ...prev, [`ch${currentChapter.chapter}_finish`]: true }));
                          }
                          setStep(step + 1);
                        }}
                      >
                        {step === allQuestions.length ? 'Finalizar ✦' : 'Siguiente →'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══ FINAL STEP: COMPLETION ═══ */}
              {step > allQuestions.length && (
                <div className="step-container animate-fade">
                  <div className="finish-screen">
                    <span className="finish-icon">🕊️</span>
                    <h1 className="finish-title">¡Excelente Trabajo!</h1>
                    <p className="finish-subtitle">
                      Has completado el estudio de <strong>Hechos {currentChapter.chapter}</strong>.<br />
                      Respondiste {answeredCount} de {allQuestions.length} preguntas.
                    </p>

                    {currentChapter.centralIdea && (
                      <div className="key-verse-card" style={{ marginBottom: '2rem' }}>
                        <span className="key-verse-label">Idea Central</span>
                        <p className="key-verse-text">{currentChapter.centralIdea}</p>
                      </div>
                    )}

                    <div className="finish-input-group">
                      <label className="entry-label">Para enviar tu reporte, ingresa tu nombre:</label>
                      <input
                        type="text"
                        className="entry-field"
                        style={{ minHeight: 'auto', padding: '0.8rem 1rem', textAlign: 'center' }}
                        value={studentName}
                        onChange={(e) => setStudentName(e.target.value)}
                        placeholder="Tu nombre completo"
                      />
                    </div>

                    <button
                      className="btn-primary"
                      style={{ padding: '1rem 2.5rem', fontSize: '0.8rem', width: '100%', maxWidth: '380px' }}
                      onClick={generateReport}
                    >
                      Enviar Reporte al Pastor 📪
                    </button>

                    <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn-secondary" onClick={() => setStep(allQuestions.length)}>
                        ← Revisar Última
                      </button>
                      <button className="btn-secondary" onClick={() => setStep(0)}>
                        Volver al Inicio
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* ═══ CONTACT PAGE ═══ */
            <div className="notebook-page animate-fade" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
              <div style={{ maxWidth: '500px', width: '100%', padding: '2rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                  <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }}>🙏</span>
                  <h1 className="chapter-title" style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>Contacto</h1>
                  <p style={{ color: 'var(--ink-muted)', fontFamily: 'EB Garamond, serif', fontSize: '1.1rem' }}>
                    Si tienes dudas, peticiones de oración o necesitas apoyo pastoral, escríbenos.
                  </p>
                </div>

                <form 
                  style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const name = formData.get('name');
                    const message = formData.get('message');
                    const subject = encodeURIComponent(`Consulta Estudio Hechos: ${name}`);
                    const body = encodeURIComponent(`Hola Pastor,\n\nMi nombre es ${name}.\n\nMensaje:\n${message}`);
                    window.location.href = `mailto:hermego54@gmail.com?subject=${subject}&body=${body}`;
                  }}
                >
                  <div className="form-group">
                    <label className="entry-label">Nombre Completo</label>
                    <input 
                      name="name" 
                      type="text" 
                      className="entry-field" 
                      required 
                      placeholder="Escribe tu nombre..." 
                      style={{ minHeight: 'auto', padding: '0.8rem 1rem' }}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label className="entry-label">Mensaje o Petición</label>
                    <textarea 
                      name="message" 
                      className="entry-field" 
                      required 
                      placeholder="¿En qué podemos ayudarte?" 
                      style={{ minHeight: '150px', padding: '1rem' }}
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="btn-primary" 
                    style={{ width: '100%', padding: '1.2rem', fontSize: '1.1rem', marginTop: '1rem' }}
                  >
                    Enviar Mensaje 📪
                  </button>
                </form>

                <div style={{ marginTop: '2.5rem', textAlign: 'center', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '1.5rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--ink-faint)', marginBottom: '0.5rem' }}>También puedes escribir directamente a:</p>
                  <a href="mailto:hermego54@gmail.com" style={{ color: 'var(--accent-gold-dark)', fontWeight: 'bold', textDecoration: 'none' }}>
                    hermego54@gmail.com
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
