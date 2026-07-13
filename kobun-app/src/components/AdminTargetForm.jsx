import { useEffect, useMemo, useState } from 'react';
import { emptyKaeritenAnswer, serializeKaeritenAnswer } from '../utils/kaeriten';

const TYPE_LABELS = {
  reading: '読み',
  rhetoric: '修辞',
  vocab: '語句',
  grammar: '文法',
  verb: '動詞',
  adj: '形容詞',
  aux: '助動詞',
  particle: '助詞',
  kaeriten: '返り点',
};

const BOLD_WORD_LIMIT = 4;
const TARGET_SURFACE_LIMIT = 3;

function normalizeQuestionSurface(value) {
  if (typeof value === 'string') return { text: value, occurrence: '' };
  return {
    text: value?.text ?? value?.surface ?? '',
    occurrence: Number.isInteger(value?.occurrence) ? String(value.occurrence) : '',
  };
}

function normalizeTargetSurface(value) {
  if (typeof value === 'string') return { text: value, occurrence: '' };
  return {
    text: value?.text ?? value?.surface ?? '',
    occurrence: Number.isInteger(value?.occurrence) ? String(value.occurrence) : '',
  };
}

function defaultTargetSurfaces(selection, initialTarget) {
  const saved = Array.isArray(initialTarget?.targetSurfaces)
    ? initialTarget.targetSurfaces
    : [selection?.text ?? initialTarget?.surface ?? ''];
  return [...saved.map(normalizeTargetSurface), {}, {}, {}]
    .slice(0, TARGET_SURFACE_LIMIT)
    .map(normalizeTargetSurface);
}

function defaultQuestionSurfaces(initialTarget) {
  const saved = Array.isArray(initialTarget?.questionSurfaces)
    ? initialTarget.questionSurfaces
    : [initialTarget?.questionSurface ?? ''];
  return [...saved.map(normalizeQuestionSurface), {}, {}, {}, {}]
    .slice(0, BOLD_WORD_LIMIT)
    .map(normalizeQuestionSurface);
}

function defaultForm(type, selection, initialTarget = null, initialSectionId = '') {
  return {
    type,
    sectionId: selection?.sectionId ?? initialSectionId ?? '',
    surface: selection?.text ?? initialTarget?.surface ?? '',
    targetSurfaces: defaultTargetSurfaces(selection, initialTarget),
    questionText: initialTarget?.questionText ?? '',
    questionSurfaces: defaultQuestionSurfaces(initialTarget),
    gradingMode: initialTarget?.gradingMode ?? 'local',
    alternativeAnswers: [
      ...(initialTarget?.alternativeAnswers ?? []),
      '', '', '', '', '',
    ].slice(0, 5),
    particleQuestionType: initialTarget?.particleQuestionType
      ?? (initialTarget?.questionText?.includes('用法') ? 'usage' : 'translation'),
    answer: initialTarget?.answer ?? '',
    meaning: initialTarget?.meaning ?? '',
    baseForm: initialTarget?.baseForm ?? '',
    conjugationType: initialTarget?.conjugationType ?? '',
    formInText: initialTarget?.formInText ?? '',
    explanation: initialTarget?.explanation ?? '',
  };
}

function answerLabel(type, form) {
  if (type === 'reading') return '読み';
  if (type === 'rhetoric') return '修辞・表現';
  if (type === 'aux') return '用法';
  if (type === 'particle') return form.particleQuestionType === 'usage' ? '用法' : '訳し方';
  if (type === 'vocab') return '意味';
  if (type === 'kaeriten') return '返り点';
  return '解答';
}

function validationMessage(type, form, isConjugationType) {
  if (!form.surface.trim() && !form.questionText.trim()) return '問題文または対象語を入力してください';
  if (isConjugationType) {
    if (!form.baseForm.trim()) return '基本形を入力してください';
    if (!form.conjugationType.trim()) return '活用の行と種類を入力してください';
    if (!form.formInText.trim()) return '文中の活用形を入力してください';
    return '';
  }
  if (!form.answer.trim()) return `${answerLabel(type, form)}を入力してください`;
  return '';
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
      targetSurfaces: selection?.text
        ? [{ text: selection.text, occurrence: '' }, ...current.targetSurfaces.slice(1)]
        : current.targetSurfaces,
      answer: type === 'kaeriten' && selection?.text && !current.answer
        ? serializeKaeritenAnswer(emptyKaeritenAnswer(selection.text), selection.text)
        : current.answer,
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
  const updateAlternative = (index, value) => {
    setForm((current) => {
      const next = [...current.alternativeAnswers];
      next[index] = value;
      return { ...current, alternativeAnswers: next };
    });
    setMessage('');
  };
  const updateQuestionSurface = (index, key, value) => {
    setForm((current) => {
      const next = [...current.questionSurfaces];
      next[index] = { ...next[index], [key]: value };
      return { ...current, questionSurfaces: next };
    });
    setMessage('');
  };
  const updateTargetSurface = (index, key, value) => {
    setForm((current) => {
      const next = [...current.targetSurfaces];
      next[index] = { ...next[index], [key]: value };
      return {
        ...current,
        targetSurfaces: next,
        surface: index === 0 && key === 'text' ? value : current.surface,
      };
    });
    setMessage('');
  };

  const isConjugationType = type === 'verb' || type === 'adj';
  const missingMessage = validationMessage(type, form, isConjugationType);
  const canSave = !missingMessage;
  const showMeaningField = type === 'verb' || type === 'adj';

  const save = async () => {
    if (saving) return;
    if (!canSave) {
      setMessage(missingMessage);
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const targetSurfaces = form.targetSurfaces
        .map((item) => {
          const text = item.text.trim();
          if (!text) return null;
          const occurrence = Number.parseInt(item.occurrence, 10);
          return Number.isInteger(occurrence) && occurrence > 0
            ? { text, occurrence }
            : text;
        })
        .filter(Boolean)
        .slice(0, TARGET_SURFACE_LIMIT);
      const surface = (typeof targetSurfaces[0] === 'string'
        ? targetSurfaces[0]
        : targetSurfaces[0]?.text) ?? form.surface.trim();
      const preservesInitialAnchor = mode === 'edit'
        && initialTarget?.surface === surface
        && initialSectionId === form.sectionId
        && Number.isInteger(initialTarget?.start);
      const start = surface && selection?.sectionId === form.sectionId && selection?.text === surface
        ? selection.start
        : preservesInitialAnchor
          ? initialTarget.start
          : surface ? section?.text?.indexOf(surface) ?? -1 : -1;
      const target = {
        ...(initialTarget ?? {}),
        id: initialTarget?.id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        surface,
        explanation: form.explanation.trim(),
        gradingMode: form.gradingMode,
      };
      if (targetSurfaces.length > 0) target.targetSurfaces = targetSurfaces;
      else delete target.targetSurfaces;
      if (start >= 0) target.start = start;
      else delete target.start;
      if (showMeaningField) target.meaning = form.meaning.trim();
      else delete target.meaning;
      if (form.questionText.trim()) target.questionText = form.questionText.trim();
      else delete target.questionText;
      const questionSurfaces = form.questionSurfaces
        .map((item) => {
          const text = item.text.trim();
          if (!text) return null;
          const occurrence = Number.parseInt(item.occurrence, 10);
          return Number.isInteger(occurrence) && occurrence > 0
            ? { text, occurrence }
            : text;
        })
        .filter(Boolean)
        .slice(0, BOLD_WORD_LIMIT);
      if (questionSurfaces.length > 0) {
        target.questionSurfaces = questionSurfaces;
        target.questionSurface = typeof questionSurfaces[0] === 'string'
          ? questionSurfaces[0]
          : questionSurfaces[0].text;
      } else {
        delete target.questionSurfaces;
        delete target.questionSurface;
      }
      const alternativeAnswers = form.alternativeAnswers.map(item => item.trim()).filter(Boolean).slice(0, 5);
      if (alternativeAnswers.length > 0) target.alternativeAnswers = alternativeAnswers;
      else delete target.alternativeAnswers;
      if (type === 'particle') target.particleQuestionType = form.particleQuestionType;
      else delete target.particleQuestionType;

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
          <input value={form.surface} onChange={(e) => updateTargetSurface(0, 'text', e.target.value)} />
        </label>
        <label>
          対象語2・3
          <div className="admin-bold-words">
            {form.targetSurfaces.slice(1).map((value, offset) => {
              const index = offset + 1;
              return (
                <div className="admin-bold-word-row" key={index}>
                  <input
                    value={value.text}
                    onChange={(e) => updateTargetSurface(index, 'text', e.target.value)}
                    placeholder={`対象語${index + 1}`}
                  />
                  <input
                    type="number"
                    min="1"
                    value={value.occurrence}
                    onChange={(e) => updateTargetSurface(index, 'occurrence', e.target.value)}
                    placeholder="何個目"
                    aria-label={`対象語${index + 1}の出現番号`}
                  />
                </div>
              );
            })}
          </div>
        </label>
        <label>
          問題文
          <textarea rows={2} value={form.questionText} onChange={(e) => update('questionText', e.target.value)} />
        </label>
        <label>
          太字にする語
          <div className="admin-bold-words">
            {form.questionSurfaces.map((value, index) => (
              <div className="admin-bold-word-row" key={index}>
                <input
                  value={value.text}
                  onChange={(e) => updateQuestionSurface(index, 'text', e.target.value)}
                  placeholder={`語${index + 1}`}
                />
                <input
                  type="number"
                  min="1"
                  value={value.occurrence}
                  onChange={(e) => updateQuestionSurface(index, 'occurrence', e.target.value)}
                  placeholder="何個目"
                  aria-label={`語${index + 1}を太字にする出現番号`}
                />
              </div>
            ))}
          </div>
        </label>
        <label>
          採点方法
          <select value={form.gradingMode} onChange={(e) => update('gradingMode', e.target.value)}>
            <option value="local">ローカル採点</option>
            <option value="ai">AI採点</option>
          </select>
        </label>
        <fieldset className="admin-alt-answers">
          <legend>別解（5個まで）</legend>
          {form.alternativeAnswers.map((value, index) => (
            <input
              key={index}
              value={value}
              onChange={(e) => updateAlternative(index, e.target.value)}
              placeholder={`別解${index + 1}`}
            />
          ))}
        </fieldset>
        {type === 'particle' && (
          <label>
            出題内容
            <select value={form.particleQuestionType} onChange={(e) => update('particleQuestionType', e.target.value)}>
              <option value="translation">訳し方</option>
              <option value="usage">用法</option>
            </select>
          </label>
        )}

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
        ) : type === 'kaeriten' ? (
          <label>
            返り点
            <div className="admin-kaeriten-empty">
              返り点の模範解答は、追加後に原文カラム上で登録してください。
            </div>
          </label>
        ) : (
          <label>
            {answerLabel(type, form)}
            <input value={form.answer} onChange={(e) => update('answer', e.target.value)} />
          </label>
        )}

        {showMeaningField && (
          <label>
            意味
            <input value={form.meaning} onChange={(e) => update('meaning', e.target.value)} />
          </label>
        )}
        <label>
          解説
          <textarea rows={2} value={form.explanation} onChange={(e) => update('explanation', e.target.value)} />
        </label>
      </div>

      <div className="admin-inline-actions">
        {message && <span className="admin-message">{message}</span>}
        <button type="button" className="admin-secondary-btn" onClick={onCancel}>キャンセル</button>
        <button type="button" onClick={save} disabled={saving}>
          {saving ? '保存中...' : (mode === 'edit' ? '更新' : '追加')}
        </button>
      </div>
    </div>
  );
}
