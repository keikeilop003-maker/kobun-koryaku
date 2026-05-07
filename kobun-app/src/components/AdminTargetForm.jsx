import { useEffect, useMemo, useState } from 'react';

const TYPE_LABELS = {
  vocab: '重要単語',
  grammar: '重要文法',
  verb: '動詞',
  adj: '形容詞',
  aux: '助動詞',
  particle: '助詞',
};

function defaultForm(type, selection, initialTarget = null, initialSectionId = '') {
  return {
    type,
    sectionId: selection?.sectionId ?? initialSectionId ?? '',
    surface: selection?.text ?? initialTarget?.surface ?? '',
    answer: initialTarget?.answer ?? '',
    meaning: initialTarget?.meaning ?? '',
    baseForm: initialTarget?.baseForm ?? '',
    conjugationType: initialTarget?.conjugationType ?? '',
    formInText: initialTarget?.formInText ?? '',
    explanation: initialTarget?.explanation ?? '',
  };
}

function answerLabel(type) {
  if (type === 'aux') return '用法';
  if (type === 'particle') return '訳し方';
  if (type === 'vocab') return '意味';
  return '解答';
}

export default function AdminTargetForm({
  type,
  selection,
  sections,
  onCancel,
  onSave,
  mode = 'add',
  initialTarget = null,
  initialSectionId = '',
}) {
  const [form, setForm] = useState(() => defaultForm(type, selection, initialTarget, initialSectionId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm((current) => ({
      ...current,
      type,
      sectionId: selection?.sectionId ?? current.sectionId,
      surface: selection?.text ?? current.surface,
    }));
  }, [type, selection]);

  const section = useMemo(
    () => sections.find((item) => item.id === form.sectionId),
    [sections, form.sectionId],
  );

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage('');
  };

  const isConjugationType = type === 'verb' || type === 'adj';
  const canSave = form.sectionId && form.surface.trim() && (
    isConjugationType
      ? form.baseForm.trim() && form.conjugationType.trim() && form.formInText.trim()
      : form.answer.trim()
  );

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const surface = form.surface.trim();
      const start = selection?.sectionId === form.sectionId && selection?.text === surface
        ? selection.start
        : section?.text?.indexOf(surface) ?? -1;
      const target = {
        ...(initialTarget ?? {}),
        id: initialTarget?.id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        surface,
        meaning: form.meaning.trim(),
        explanation: form.explanation.trim(),
        start: start >= 0 ? start : undefined,
      };

      if (mode === 'add') target.custom = true;

      if (isConjugationType) {
        target.baseForm = form.baseForm.trim();
        target.conjugationType = form.conjugationType.trim();
        target.formInText = form.formInText.trim();
      } else {
        target.answer = form.answer.trim();
      }

      await onSave({
        sectionId: form.sectionId,
        target,
        anchor: {
          sectionId: form.sectionId,
          text: surface,
          start: start >= 0 ? start : null,
          end: start >= 0 ? start + surface.length : null,
        },
      });
      if (mode === 'add') setForm(defaultForm(type, null));
      setMessage(mode === 'edit' ? '更新しました' : '追加しました');
    } catch (err) {
      console.error('[AdminTargetForm] save failed:', err);
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-inline-form">
      <div className="admin-inline-title">
        <strong>{TYPE_LABELS[type] ?? type}{mode === 'edit' ? 'の問題編集' : 'の問題追加'}</strong>
        <span>{mode === 'edit' ? '内容を修正して保存できます。' : '左カラムで範囲を選ぶと、対象語に反映されます。'}</span>
      </div>

      <div className="admin-form-grid">
        <label>
          段
          <select value={form.sectionId} onChange={(e) => update('sectionId', e.target.value)}>
            <option value="">未選択</option>
            {sections.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <label>
          対象語
          <input value={form.surface} onChange={(e) => update('surface', e.target.value)} />
        </label>

        {isConjugationType ? (
          <>
            <label>
              基本形
              <input value={form.baseForm} onChange={(e) => update('baseForm', e.target.value)} />
            </label>
            <label>
              活用の行と種類
              <input value={form.conjugationType} onChange={(e) => update('conjugationType', e.target.value)} />
            </label>
            <label>
              文中の活用形
              <input value={form.formInText} onChange={(e) => update('formInText', e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            {answerLabel(type)}
            <input value={form.answer} onChange={(e) => update('answer', e.target.value)} />
          </label>
        )}

        <label>
          意味
          <input value={form.meaning} onChange={(e) => update('meaning', e.target.value)} />
        </label>
        <label>
          解説
          <textarea rows={2} value={form.explanation} onChange={(e) => update('explanation', e.target.value)} />
        </label>
      </div>

      <div className="admin-inline-actions">
        {message && <span className="admin-message">{message}</span>}
        <button type="button" className="admin-secondary-btn" onClick={onCancel}>キャンセル</button>
        <button type="button" onClick={save} disabled={!canSave || saving}>
          {saving ? '保存中...' : (mode === 'edit' ? '更新' : '追加')}
        </button>
      </div>
    </div>
  );
}
