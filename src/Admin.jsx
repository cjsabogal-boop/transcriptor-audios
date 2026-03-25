import React, { useState } from 'react';
import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

function Admin({ onStudyAdded }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    chapter: '',
    title: '',
    objective: '',
    contextQuestions: '',
    observationParts: '', // We'll parse this
    meaningQuestions: '',
    applicationQuestions: '',
    gospelQuestions: '',
    keyVerse: '',
    centralIdea: '',
    spotifyTrackId: '',
    image: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Basic split by newline for questions
      const study = {
        chapter: parseInt(formData.chapter),
        title: formData.title,
        objective: formData.objective,
        context: { questions: formData.contextQuestions.split('\n').filter(q => q.trim()) },
        observation: formData.observationParts.split('---').map(partStr => {
           const lines = partStr.trim().split('\n');
           return {
             part: lines[0],
             questions: lines.slice(1).filter(l => l.trim())
           };
        }),
        meaning: formData.meaningQuestions.split('\n').filter(q => q.trim()),
        application: formData.applicationQuestions.split('\n').filter(q => q.trim()),
        gospel: formData.gospelQuestions.split('\n').filter(q => q.trim()),
        keyVerse: formData.keyVerse,
        centralIdea: formData.centralIdea,
        spotifyTrackId: formData.spotifyTrackId,
        image: formData.image || '/assets/hero.png',
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "studies"), study);
      alert("✅ ¡Estudio subido con éxito!");
      setFormData({
        chapter: '', title: '', objective: '', contextQuestions: '', 
        observationParts: '', meaningQuestions: '', applicationQuestions: '', 
        gospelQuestions: '', keyVerse: '', centralIdea: '', spotifyTrackId: '', image: ''
      });
      if (onStudyAdded) onStudyAdded();
    } catch (err) {
      console.error(err);
      alert("❌ Error al subir: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="notebook-page" style={{maxWidth: '700px'}}>
      <header className="notebook-header">
        <h1>Panel Pastor</h1>
        <p style={{color: 'var(--text-muted)'}}>Sube un nuevo estudio siguiendo el método COMA.</p>
      </header>

      <form onSubmit={handleSubmit} style={{marginTop: '3rem'}}>
        <div className="entry-group">
          <label className="entry-label">Capítulo (Número)</label>
          <input 
            type="number" className="entry-field" style={{minHeight: 'auto'}}
            value={formData.chapter} onChange={e => setFormData({...formData, chapter: e.target.value})}
            required
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Título del Estudio</label>
          <input 
            type="text" className="entry-field" style={{minHeight: 'auto'}}
            value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})}
            required
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Objetivo</label>
          <textarea 
            className="entry-field"
            value={formData.objective} onChange={e => setFormData({...formData, objective: e.target.value})}
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Preguntas de Contexto (Una por línea)</label>
          <textarea 
            className="entry-field"
            value={formData.contextQuestions} onChange={e => setFormData({...formData, contextQuestions: e.target.value})}
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Observación (Formato: TituloParte\nPregunta1\nPregunta2\n--- para separar partes)</label>
          <textarea 
            className="entry-field"
            value={formData.observationParts} onChange={e => setFormData({...formData, observationParts: e.target.value})}
            placeholder="Hechos 1:1-5&#10;¿A quién fue escrito?&#10;---&#10;Hechos 1:6-11&#10;¿Qué prometió Jesús?"
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Significado (Una por línea)</label>
          <textarea className="entry-field" value={formData.meaningQuestions} onChange={e => setFormData({...formData, meaningQuestions: e.target.value})} />
        </div>

        <div className="entry-group">
          <label className="entry-label">Aplicación (Una por línea)</label>
          <textarea className="entry-field" value={formData.applicationQuestions} onChange={e => setFormData({...formData, applicationQuestions: e.target.value})} />
        </div>

        <div className="entry-group">
          <label className="entry-label">Versículo Clave e Idea Central</label>
          <input 
            type="text" className="entry-field" style={{minHeight: 'auto', marginBottom: '1rem'}}
            placeholder="Versículo"
            value={formData.keyVerse} onChange={e => setFormData({...formData, keyVerse: e.target.value})}
          />
          <input 
            type="text" className="entry-field" style={{minHeight: 'auto'}}
            placeholder="Idea Central"
            value={formData.centralIdea} onChange={e => setFormData({...formData, centralIdea: e.target.value})}
          />
        </div>

        <div className="entry-group">
          <label className="entry-label">Spotify Track ID</label>
          <input 
            type="text" className="entry-field" style={{minHeight: 'auto'}}
            value={formData.spotifyTrackId} onChange={e => setFormData({...formData, spotifyTrackId: e.target.value})}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={loading} style={{width: '100%'}}>
          {loading ? 'Subiendo...' : 'Publicar Estudio 🚀'}
        </button>
      </form>
    </div>
  );
}

export default Admin;
