import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

const TYPE_OPTIONS = [
  { value: 'verb', label: '動詞' },
  { value: 'aux', label: '助動詞' },
  { value: 'particle', label: '助詞' },
  { value: 'adj', label: '形容詞' },
  { value: 'vocab', label: '重要語句' },
  { value: 'grammar', label: '重要文法' },
];

function defaultForm(type, selection, sectionId) {
  return {
    type,
    sectionId: selection?.sectionId ?? sectionId ?? '',
    surface: selection?.text ?? '',
    reading: '',
    answer: '',
    meaning: '',
    detail: '',
    baseForm: '',
    conjugationType: '',
    formInText: '',
    explanation: '',
  };
}

export default function AdminQuestionPanel({ textId, sections, selection, user }) {
  const firstSectionId = sections?.[0]?.id ?? '';
  const [type, setType] = useState('verb');
  const [form, setForm] = useState(() => defaultForm('verb', selection, firstSectionId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === form.sectionId),
    [sections, form.sectionId],
  );

  useEffect(() => {
    if (!selection) return;
    setForm((current) => ({
      ...current,
      sectionId: selection.sectionId,
      surface: selection.text,
    }));
  }, [selection]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage('');
  };

  const changeType = (nextType) => {
    setType(nextType);
    setForm((current) => ({ ...defaultForm(nextType, selection, firstSectionId), sectionId: current.sectionId, surface: current.surface }));
    setMessage('');
  };

  const buildTarget = () => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const anchorStart = selection?.sectionId === form.sectionId && selection?.text === form.surface
      ? selection.start
      : selectedSection?.text?.indexOf(form.surface) ?? -1;

    const target = {
      id,
      type: form.type,
      surface: form.surface.trim(),
      reading: form.reading.trim(),
      pos: '',
      meaning: form.meaning.trim(),
      detail: form.detail.trim(),
      explanation: form.explanation.trim(),
      start: anchorStart >= 0 ? anchorStart : undefined,
      custom: true,
    };

    if (['verb', 'adj'].includes(form.type)) {
      target.baseForm = form.baseForm.trim();
      target.conjugationType = form.conjugationType.trim();
      target.formInText = form.formInText.trim();
    } else {
      target.answer = form.answer.trim();
    }

    return {
      target,
      anchor: {
        sectionId: form.sectionId,
        text: form.surface.trim(),
        start: anchorStart >= 0 ? anchorStart : null,
        end: anchorStart >= 0 ? anchorStart + form.surface.trim().length : null,
      },
    };
  };

  const canSave = form.sectionId && form.surface.trim() && (
    ['verb', 'adj'].includes(form.type)
      ? form.baseForm.trim() && form.conjugationType.trim() && form.formInText.trim()
      : form.answer.trim()
  );

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const { target, anchor } = buildTarget();
      await addDoc(collection(db, 'customTargets'), {
        textId,
        sectionId: form.sectionId,
        target,
        anchor,
        createdBy: user.uid,
        createdByEmail: user.email,
        createdAt: serverTimestamp(),
      });
      setForm(defaultForm(type, null, form.sectionId));
      setMessage('追加しました');
    } catch (err) {
      console.error('[AdminQuestionPanel] create failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel-header">
        <span className="admin-title">問題追加</span>
        {selection && <span className="admin-selection">「{selection.text}」</span>}
      </div>

      <div className="admin-form">
        <div className="admin-row">
          <label>
            種別
            <select value={type} onChange={(e) => changeType(e.target.value)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            段
            <select value={form.sectionId} onChange={(e) => update('sectionId', e.target.value)}>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.title}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          表面形
          <input value={form.surface} onChange={(e) => update('surface', e.target.value)} />
        </label>
        <label>
          読み
          <input value={form.reading} onChange={(e) => update('reading', e.target.value)} />
        </label>

        {['verb', 'adj'].includes(type) ? (
          <>
            <label>
              基本形
              <input value={form.baseForm} onChange={(e) => update('baseForm', e.target.value)} />
            </label>
            <label>
              活用の種類
              <input value={form.conjugationType} onChange={(e) => update('conjugationType', e.target.value)} />
            </label>
            <label>
              文中の活用形
              <input value={form.formInText} onChange={(e) => update('formInText', e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            模範解答
            <input value={form.answer} onChange={(e) => update('answer', e.target.value)} />
          </label>
        )}

        <label>
          意味
          <input value={form.meaning} onChange={(e) => update('meaning', e.target.value)} />
        </label>
        <label>
          詳細
          <textarea rows={3} value={form.detail} onChange={(e) => update('detail', e.target.value)} />
        </label>
        <label>
          解説
          <textarea rows={3} value={form.explanation} onChange={(e) => update('explanation', e.target.value)} />
        </label>

        <div className="admin-actions">
          {message && <span className="admin-message">{message}</span>}
          <button onClick={save} disabled={!canSave || saving}>{saving ? '保存中...' : '追加'}</button>
        </div>
      </div>
    </div>
  );
}
