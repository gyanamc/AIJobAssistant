import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, Alert, TextInput, Modal,
} from 'react-native';
import { useApplicationStore } from '../store/useApplicationStore';
import type { DraftApplication } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

export default function ApplicationsScreen() {
  const { drafts, deleteDraft, updateDraft } = useApplicationStore();
  const [selected, setSelected] = useState<DraftApplication | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  function openDraft(draft: DraftApplication) {
    setSelected(draft);
    setEditText(draft.cover_letter);
    setEditing(false);
  }

  function handleDelete(id: string) {
    Alert.alert('Remove Application', 'Delete this draft?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDraft(id) },
    ]);
  }

  async function handleSaveEdit() {
    if (!selected) return;
    await updateDraft(selected.id, { cover_letter: editText });
    setEditing(false);
    setSelected(null);
  }

  const isAutoApplied = (status: string) => status === 'auto-applied';

  const renderItem = ({ item }: { item: DraftApplication }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDraft(item)} activeOpacity={0.85}>
      {/* Left accent bar */}
      <View style={[styles.accentBar, isAutoApplied(item.status) ? styles.accentPurple : styles.accentGreen]} />

      <View style={styles.cardInner}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, marginRight: S.sm }}>
            <Text style={styles.cardCompany} numberOfLines={1}>{item.company}</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.job_title}</Text>
          </View>
          <View style={[styles.statusBadge, isAutoApplied(item.status) ? styles.badgePurple : styles.badgeSurface]}>
            <Text style={[styles.statusText, isAutoApplied(item.status) ? styles.statusPurpleText : styles.statusDefaultText]}>
              {isAutoApplied(item.status) ? '⚡ Applied' : 'Draft'}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
          <TouchableOpacity onPress={() => handleDelete(item.id)}>
            <Text style={styles.deleteText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Applications</Text>
        {drafts.length > 0 && (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{drafts.length}</Text>
          </View>
        )}
      </View>

      {drafts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>◎</Text>
          <Text style={styles.emptyTitle}>No applications yet</Text>
          <Text style={styles.emptyBody}>Swipe right on a job to start applying.</Text>
        </View>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={d => d.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Detail modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHandle} />

          <Text style={styles.modalCompany} numberOfLines={1}>{selected?.company}</Text>
          <Text style={styles.modalTitle} numberOfLines={2}>{selected?.job_title}</Text>

          <Text style={styles.sectionLabel}>Cover Letter</Text>

          {editing ? (
            <TextInput
              style={styles.editor}
              multiline
              value={editText}
              onChangeText={setEditText}
            />
          ) : (
            <Text style={styles.coverLetterText}>{selected?.cover_letter || 'No cover letter saved.'}</Text>
          )}

          {/* Actions */}
          <View style={styles.modalActions}>
            {selected?.status === 'draft' && !editing && (
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
            {editing && (
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingTop: 56,
    paddingHorizontal: S.xl,
    paddingBottom: S.lg,
  },
  headerTitle: {
    fontSize: T.xl,
    fontWeight: T.black_w,
    color: C.text,
    letterSpacing: -0.3,
  },
  countPill: {
    backgroundColor: C.accentDim,
    paddingHorizontal: S.sm,
    paddingVertical: 2,
    borderRadius: R.pill,
  },
  countText: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.accent,
  },

  // List
  list: {
    paddingHorizontal: S.xl,
    paddingBottom: S.xxxl,
    gap: S.sm,
  },

  // Card
  card: {
    backgroundColor: C.surface2,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    overflow: 'hidden',
    ...SHADOW.subtle,
  },
  accentBar: {
    width: 3,
  },
  accentGreen: {
    backgroundColor: C.accent,
  },
  accentPurple: {
    backgroundColor: '#7C3AED',
  },
  cardInner: {
    flex: 1,
    padding: S.md,
    gap: S.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardCompany: {
    fontSize: T.xs,
    fontWeight: T.medium,
    color: C.textSub,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: T.base,
    fontWeight: T.semibold,
    color: C.text,
  },
  statusBadge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    alignSelf: 'flex-start',
  },
  badgeSurface: {
    backgroundColor: C.surface3,
  },
  badgePurple: {
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
  },
  statusText: {
    fontSize: T.xs,
    fontWeight: T.bold,
  },
  statusDefaultText: {
    color: C.textSub,
  },
  statusPurpleText: {
    color: '#A78BFA',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: T.xs,
    color: C.textDim,
  },
  deleteText: {
    fontSize: T.xs,
    color: C.red,
    fontWeight: T.medium,
  },

  // Empty
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.xxl,
  },
  emptyGlyph: {
    fontSize: 36,
    color: C.textDim,
    marginBottom: S.sm,
  },
  emptyTitle: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.text,
  },
  emptyBody: {
    fontSize: T.base,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: T.loose,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: S.xl,
    paddingBottom: 36,
  },
  modalHandle: {
    width: 36,
    height: 3,
    backgroundColor: C.surface3,
    borderRadius: R.pill,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: S.xl,
  },
  modalCompany: {
    fontSize: T.sm,
    fontWeight: T.medium,
    color: C.textSub,
    letterSpacing: 0.3,
    marginBottom: S.xs,
  },
  modalTitle: {
    fontSize: T.xl,
    fontWeight: T.bold,
    color: C.text,
    lineHeight: T.xl * 1.3,
    marginBottom: S.xl,
  },
  sectionLabel: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: S.sm,
  },
  coverLetterText: {
    flex: 1,
    color: C.textSub,
    fontSize: T.base,
    lineHeight: T.loose,
  },
  editor: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    borderRadius: R.md,
    padding: S.lg,
    fontSize: T.base,
    lineHeight: T.loose,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: S.sm,
    paddingTop: S.lg,
  },
  editBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  editBtnText: {
    color: C.text,
    fontWeight: T.semibold,
    fontSize: T.base,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: R.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
  },
  saveBtnText: {
    color: C.black,
    fontWeight: T.bold,
    fontSize: T.base,
  },
  closeBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: R.pill,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  closeBtnText: {
    color: C.textSub,
    fontWeight: T.medium,
    fontSize: T.base,
  },
});
