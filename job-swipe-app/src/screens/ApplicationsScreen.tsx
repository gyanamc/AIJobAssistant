import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, Alert, TextInput, Modal,
} from 'react-native';
import { useApplicationStore } from '../store/useApplicationStore';
import type { DraftApplication } from '../types';

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
    Alert.alert('Delete Application', 'Remove this draft?', [
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

  const renderItem = ({ item }: { item: DraftApplication }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDraft(item)}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.jobTitle}>{item.job_title}</Text>
          <Text style={styles.company}>{item.company}</Text>
        </View>
        <View style={[styles.badge, item.status === 'auto-applied' ? styles.autoBadge : styles.draftBadge]}>
          <Text style={styles.badgeText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
      <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>My Applications</Text>
      {drafts.length === 0 ? (
        <Text style={styles.empty}>No applications yet. Swipe right on a job to apply.</Text>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={d => d.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
        />
      )}

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{selected?.job_title}</Text>
          <Text style={styles.modalCompany}>{selected?.company}</Text>
          {editing ? (
            <TextInput
              style={styles.editor}
              multiline
              value={editText}
              onChangeText={setEditText}
            />
          ) : (
            <Text style={styles.coverLetter}>{selected?.cover_letter}</Text>
          )}
          <View style={styles.modalActions}>
            {selected?.status === 'draft' && !editing && (
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
            )}
            {editing && (
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { fontSize: 22, fontWeight: '800', color: '#f1f5f9', padding: 20, paddingTop: 56 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, paddingHorizontal: 32, fontSize: 15 },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  jobTitle: { fontSize: 16, fontWeight: '700', color: '#f1f5f9' },
  company: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  draftBadge: { backgroundColor: '#334155' },
  autoBadge: { backgroundColor: '#7c3aed' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  date: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  deleteBtn: { alignSelf: 'flex-end' },
  deleteText: { color: '#ef4444', fontSize: 13 },
  modal: { flex: 1, backgroundColor: '#0f172a', padding: 24, paddingTop: 48 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  modalCompany: { fontSize: 14, color: '#94a3b8', marginBottom: 20 },
  coverLetter: { color: '#cbd5e1', fontSize: 15, lineHeight: 22, flex: 1 },
  editor: { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 15, flex: 1, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12, paddingTop: 16 },
  editBtn: { flex: 1, backgroundColor: '#334155', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  editText: { color: '#f1f5f9', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#22c55e', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
  closeBtn: { flex: 1, backgroundColor: '#1e293b', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeText: { color: '#94a3b8', fontWeight: '600' },
});
