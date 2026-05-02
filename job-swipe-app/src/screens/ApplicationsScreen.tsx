import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, Alert, TextInput, Linking, Clipboard,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Trash2 } from 'lucide-react-native';

import type { RootStackParamList } from '../navigation/AppNavigator';
import { useApplicationStore } from '../store/useApplicationStore';
import { useAuthStore } from '../store/useAuthStore';
import type { DraftApplication } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

type NavigationProp = StackNavigationProp<RootStackParamList>;

export default function ApplicationsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { drafts, deleteDraft, updateDraft } = useApplicationStore();
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  
  const [selected, setSelected] = useState<DraftApplication | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  // Bottom Sheet logic
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['50%', '90%'], []);

  function openDraft(draft: DraftApplication) {
    setSelected(draft);
    setEditText(draft.cover_letter);
    setEditing(false);
    bottomSheetRef.current?.expand();
  }

  function handleCloseSheet() {
    bottomSheetRef.current?.close();
    setTimeout(() => {
      setSelected(null);
      setEditing(false);
    }, 300);
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
    setSelected({ ...selected, cover_letter: editText });
  }

  const isApplied = (status: string) => status === 'applied' || status === 'auto-applied';

  const getStatusBadge = (status: string) => {
    if (status === 'auto-applied') return { label: '⚡ Auto-Applied', style: styles.badgePurple, textStyle: styles.statusPurpleText };
    if (status === 'applied')      return { label: '✅ Applied',      style: styles.badgeGreen,  textStyle: styles.statusGreenText };
    return                                { label: 'Draft',           style: styles.badgeSurface, textStyle: styles.statusDefaultText };
  };

  const renderRightActions = (id: string) => (
    <View style={styles.deleteActionContainer}>
      <TouchableOpacity style={styles.deleteAction} onPress={() => handleDelete(id)}>
        <Trash2 color={C.white} size={24} />
      </TouchableOpacity>
    </View>
  );

  const renderItem = ({ item }: { item: DraftApplication }) => (
    <Swipeable renderRightActions={() => renderRightActions(item.id)} overshootRight={false}>
      <TouchableOpacity style={styles.card} onPress={() => openDraft(item)} activeOpacity={0.85}>
        <View style={[styles.accentBar, isApplied(item.status) ? styles.accentPurple : styles.accentGreen]} />
        <View style={styles.cardInner}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1, marginRight: S.sm }}>
              <Text style={styles.cardCompany} numberOfLines={1}>{item.company}</Text>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.job_title}</Text>
            </View>
            {(() => {
              const badge = getStatusBadge(item.status);
              return (
                <View style={[styles.statusBadge, badge.style]}>
                  <Text style={[styles.statusText, badge.textStyle]}>{badge.label}</Text>
                </View>
              );
            })()}
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
            <Text style={styles.swipeHint}>← swipe to delete</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
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
        !isAuthenticated ? (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◉</Text>
            <Text style={styles.emptyTitle}>Track your applications</Text>
            <Text style={styles.emptyBody}>
              Sign in to see your saved applications and cover letters.
            </Text>
            <TouchableOpacity
              style={styles.signInButton}
              onPress={() => navigation.navigate('AuthGate', { returnTo: 'Applications' })}
              activeOpacity={0.85}
            >
              <Text style={styles.signInButtonText}>Sign in to continue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◎</Text>
            <Text style={styles.emptyTitle}>No applications yet</Text>
            <Text style={styles.emptyBody}>Swipe right on a job to start applying.</Text>
          </View>
        )
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={d => d.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Bottom Sheet */}
      {selected && (
        <BottomSheet
          ref={bottomSheetRef}
          index={0}
          snapPoints={snapPoints}
          enablePanDownToClose
          onClose={handleCloseSheet}
          backgroundStyle={styles.bottomSheetBg}
          handleIndicatorStyle={styles.handleIndicator}
          backdropComponent={props => (
            <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
          )}
        >
          <BottomSheetView style={styles.sheetContent}>
            <Text style={styles.modalCompany} numberOfLines={1}>{selected.company}</Text>
            <Text style={styles.modalTitle} numberOfLines={2}>{selected.job_title}</Text>

            <Text style={styles.sectionLabel}>Cover Letter</Text>

            {editing ? (
              <TextInput
                style={styles.editor}
                multiline
                value={editText}
                onChangeText={setEditText}
                autoFocus
              />
            ) : (
              <View style={styles.coverLetterBox}>
                <Text style={styles.coverLetterText}>{selected.cover_letter || 'No cover letter saved.'}</Text>
              </View>
            )}

            {/* Actions */}
            <View style={styles.modalActions}>
              {selected.apply_url ? (
                <TouchableOpacity
                  style={styles.applyNowBtn}
                  onPress={() => {
                    if (selected.cover_letter) Clipboard.setString(selected.cover_letter);
                    Linking.openURL(selected.apply_url);
                  }}
                >
                  <Text style={styles.applyNowBtnText}>🚀 Apply Now</Text>
                </TouchableOpacity>
              ) : null}
              {selected.status === 'draft' && !editing && (
                <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>
              )}
              {editing && (
                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              )}
            </View>
          </BottomSheetView>
        </BottomSheet>
      )}
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
    fontWeight: '800',
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
    fontWeight: '700',
    color: C.accent,
  },

  // List
  list: {
    paddingHorizontal: S.xl,
    paddingBottom: S.xxxl,
  },

  // Card
  card: {
    backgroundColor: C.surface2,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: S.sm,
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
    fontWeight: '500',
    color: C.textSub,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: T.base,
    fontWeight: '600',
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
  badgeGreen: {
    backgroundColor: 'rgba(0,200,150,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.3)',
  },
  statusText: {
    fontSize: T.xs,
    fontWeight: '700',
  },
  statusDefaultText: {
    color: C.textSub,
  },
  statusPurpleText: {
    color: '#A78BFA',
  },
  statusGreenText: {
    color: C.accent,
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
  swipeHint: {
    fontSize: T.xs,
    color: C.textDim,
    fontStyle: 'italic',
  },

  // Swipe action
  deleteActionContainer: {
    width: 80,
    marginBottom: S.sm,
    marginLeft: S.sm,
  },
  deleteAction: {
    flex: 1,
    backgroundColor: C.red,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: R.lg,
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
    fontWeight: '600',
    color: C.text,
  },
  emptyBody: {
    fontSize: T.base,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: T.loose,
  },
  signInButton: {
    marginTop: S.lg,
    paddingVertical: 13,
    paddingHorizontal: S.xxl,
    backgroundColor: C.accent,
    borderRadius: R.pill,
    ...SHADOW.subtle,
  },
  signInButtonText: {
    fontSize: T.base,
    fontWeight: '700',
    color: C.black,
    letterSpacing: 0.2,
  },

  // Bottom Sheet
  bottomSheetBg: {
    backgroundColor: '#1A2333',
  },
  handleIndicator: {
    backgroundColor: C.textDim,
    width: 40,
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: S.xl,
    paddingTop: S.sm,
    paddingBottom: 36,
  },
  modalCompany: {
    fontSize: T.sm,
    fontWeight: '500',
    color: C.textSub,
    letterSpacing: 0.3,
    marginBottom: S.xs,
  },
  modalTitle: {
    fontSize: T.xl,
    fontWeight: '700',
    color: C.text,
    lineHeight: 24,
    marginBottom: S.xl,
  },
  sectionLabel: {
    fontSize: T.xs,
    fontWeight: '700',
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: S.sm,
  },
  coverLetterBox: {
    flex: 1,
    backgroundColor: C.surface,
    padding: S.lg,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  coverLetterText: {
    color: C.textSub,
    fontSize: T.base,
    lineHeight: T.loose,
  },
  editor: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.accent,
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
  applyNowBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: R.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
    ...SHADOW.subtle,
  },
  applyNowBtnText: {
    color: C.black,
    fontWeight: '700',
    fontSize: T.base,
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
    fontWeight: '600',
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
    fontWeight: '700',
    fontSize: T.base,
  },
});
