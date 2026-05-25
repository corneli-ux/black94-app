/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRASH-PROOF CHAT ROOM SCREEN v3 — Complete Ground-Up Rebuild
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DEFENSES:
 * 1. ChatErrorBoundary — catches any React render crash, shows recovery UI
 * 2. LazyScreenErrorBoundary (in AppNavigator) — catches module load crashes
 * 3. safeImageSource() — prevents Image crash on corrupted mediaUrl
 * 4. renderMessage try/catch — one bad message doesn't crash the list
 * 5. All props have safe defaults — no undefined/null access
 * 6. No native module calls during render — all in effects/callbacks
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { Component } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Message } from '../lib/api';
import { auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { useChatRoom } from '../hooks/useChatRoom';
import { AppIcon } from '../components/icons';

// ── Error Boundary ──────────────────────────────────────────────────────────
// This is the #1 defense — any throw during rendering (corrupted data, type errors,
// native module errors) is caught and shows a retry button.
class ChatErrorBoundary extends Component<
  { children: React.ReactNode; navigation?: any },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ChatRoom v3] Render error caught:', error?.message || error);
    console.error('[ChatRoom v3] Component stack:', info.componentStack);
  }

  handleGoBack = () => {
    this.setState({ hasError: false, error: null });
    this.props.navigation?.goBack();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }]}>
          <AppIcon name="warning-amber" size="hero" color={colors.like} />
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
            Something went wrong loading this chat
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 18 }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
            <TouchableOpacity
              style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.bgSubtle, borderRadius: 12, borderWidth: 1, borderColor: colors.borderSubtle }}
              onPress={this.handleGoBack}
              activeOpacity={0.7}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>Go Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.white, borderRadius: 12 }}
              onPress={() => this.setState({ hasError: false, error: null })}
              activeOpacity={0.7}
            >
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

// ── Safe image source helper ──────────────────────────────────────────────────
function safeImageSource(uri: string | null | undefined): { uri: string } | undefined {
  if (typeof uri === 'string' && uri.startsWith('http')) {
    return { uri };
  }
  return undefined;
}

function formatTime(timestamp?: number | string): string {
  if (!timestamp) return '';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Export ───────────────────────────────────────────────────────────────────
export default function ChatRoomScreen({ route, navigation }: any) {
  return (
    <ChatErrorBoundary navigation={navigation}>
      <ChatRoomContent route={route} navigation={navigation} />
    </ChatErrorBoundary>
  );
}

// ── Main Content ──────────────────────────────────────────────────────────────
function ChatRoomContent({ route, navigation }: any) {
  const {
    chat,
    messages,
    loading,
    text,
    setText,
    sending,
    uploading,
    showMenu,
    setShowMenu,
    showAttachMenu,
    setShowAttachMenu,
    showNuclearConfirm,
    setShowNuclearConfirm,
    blocking,
    replyTo,
    setReplyTo,
    fullscreenImage,
    setFullscreenImage,
    reactionMsg,
    setReactionMsg,
    contextMsg,
    setContextMsg,
    isRecording,
    recordingDuration,
    playingVoiceId,
    handleSend,
    handlePickImage,
    handleCamera,
    handleOpenGifPicker,
    handleStartVoiceRecord,
    handleStopVoiceRecord,
    handlePlayVoice,
    handleReaction,
    handleDeleteMessage,
    handleNuclearBlock,
    flatRef,
  } = useChatRoom({
    routeChat: route.params?.chat,
    routeChatId: route.params?.chatId,
    shareMessage: route.params?.shareMessage || null,
    routeParams: route.params,
    navigation,
  });

  const insets = useSafeAreaInsets();
  const currentUser = auth()?.currentUser;

  // Safe other user — ALWAYS defined, never undefined/null
  const safeOtherUser = chat?.otherUser || { displayName: 'Chat', username: '', profileImage: null };

  // ── Message Renderer ──────────────────────────────────────────────────────
  const renderMessage = ({ item }: { item: Message }) => {
    try {
      const isMine = item.senderId === currentUser?.uid;
      const msgType = item.messageType || 'text';
      const reactionEntries = item.reactions ? Object.values(item.reactions) as string[] : [];

      // Deleted message placeholder
      if (item.deleted) {
        return (
          <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
            {!isMine && <Avatar uri={safeOtherUser.profileImage} name={safeOtherUser.displayName} size={28} />}
            <View style={styles.deletedBubble}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppIcon name="block" size="sm" color={isMine ? colors.overlayLight : colors.textMuted} />
                <Text style={[styles.bubbleText, isMine ? { color: colors.overlayLight } : { color: colors.textMuted }, { fontStyle: 'italic' }]}>
                  This message was deleted
                </Text>
              </View>
              <Text style={[styles.bubbleTime, isMine ? { color: colors.overlayLight } : { color: colors.textMuted }]}>
                {formatTime(item.createdAt)}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
          {!isMine && <Avatar uri={safeOtherUser.profileImage} name={safeOtherUser.displayName} size={28} />}
          <TouchableOpacity
            onLongPress={() => setContextMsg(item)}
            onPress={() => {
              if (msgType === 'text') setReplyTo(item);
            }}
            activeOpacity={1}
            style={{ maxWidth: '80%' }}
          >
            {/* Image message — no bubble wrapper, image only */}
            {msgType === 'image' && safeImageSource(item.mediaUrl) ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setFullscreenImage(typeof item.mediaUrl === 'string' ? item.mediaUrl : null)}
              >
                <Image
                  source={safeImageSource(item.mediaUrl)}
                  style={styles.bubbleImage}
                  resizeMode="cover"
                  onError={() => {/* silently degrade */}}
                />
              </TouchableOpacity>
            ) : null}

            {/* GIF message — no bubble wrapper, image only */}
            {msgType === 'gif' && safeImageSource(item.mediaUrl) ? (
              <Image
                source={safeImageSource(item.mediaUrl)}
                style={styles.bubbleGif}
                resizeMode="contain"
                onError={() => {/* silently degrade */}}
              />
            ) : null}

            {/* Voice message — keep bubble for controls */}
            {msgType === 'voice' && (
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, styles.voiceBubbleWrap]}>
                <TouchableOpacity
                  style={styles.voiceBubble}
                  onPress={() => handlePlayVoice(item)}
                  activeOpacity={0.7}
                >
                  <AppIcon
                    name={playingVoiceId === item.id ? 'pause-circle' : 'play-circle'}
                    size="4xl"
                    color={isMine ? colors.primaryForeground : colors.text}
                  />
                  <View style={styles.voiceWaveform}>
                    <View style={[styles.voiceBar, isMine ? { backgroundColor: colors.overlay } : { backgroundColor: colors.accentBorderStrong }]} />
                    <View style={[styles.voiceBar, isMine ? { backgroundColor: colors.overlay } : { backgroundColor: colors.white50 }]} />
                    <View style={[styles.voiceBar, isMine ? { backgroundColor: colors.overlay } : { backgroundColor: colors.accentBorderStrong }]} />
                    <View style={[styles.voiceBar, isMine ? { backgroundColor: colors.overlayDark } : { backgroundColor: colors.borderWhite40 }]} />
                    <View style={[styles.voiceBar, isMine ? { backgroundColor: colors.overlayLight } : { backgroundColor: colors.accentBorder }]} />
                  </View>
                  <Text style={[styles.voiceDuration, isMine ? { color: colors.overlayDark } : { color: colors.textSecondary }]}>
                    {item.voiceDuration || 0}s
                  </Text>
                </TouchableOpacity>
              </View>
            )}

              {/* Reply indicator */}
              {item.replyToContent && (
                <View style={styles.replyIndicator}>
                  <Text style={styles.replyIndicatorName}>{item.replyToSenderName || 'Reply'}</Text>
                  <Text style={styles.replyIndicatorText} numberOfLines={1}>{item.replyToContent}</Text>
                </View>
              )}

              {/* Text content — minimal: no bubble background, just white text */}
              {item.content && msgType === 'text' ? (
                <Text style={styles.minimalText}>
                  {typeof item.content === 'string' ? item.content : ''}
                </Text>
              ) : null}

            {/* Timestamp — subtle, below content */}

            {/* Reactions */}
            {reactionEntries.length > 0 && (
              <View style={styles.reactionBadge}>
                <Text style={styles.reactionText}>{reactionEntries.join('')}</Text>
              </View>
            )}

            {/* Read receipt — below text, inline */}
            {isMine && (
              <View style={styles.receiptRow}>
                {item.status === 'read' ? (
                  <AppIcon name="task-alt" size="sm" color="#38bdf8" />
                ) : item.status === 'delivered' ? (
                  <AppIcon name="task-alt" size="sm" color={colors.overlayLight} />
                ) : (
                  <AppIcon name="check" size="sm" color={colors.overlayLight} />
                )}
              </View>
            )}
          </TouchableOpacity>
        </View>
      );
    } catch (renderErr) {
      // CRASH FIX: Any rendering error in a single message bubble is caught
      // so the entire FlatList doesn't crash.
      return (
        <View key={item.id} style={[styles.msgRow, { marginVertical: 2, paddingHorizontal: 16 }]}>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Message could not be displayed</Text>
        </View>
      );
    }
  };

  // ── Loading State ──────────────────────────────────────────────────────────
  if (!chat) {
    return (
      <View style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // ── Main Render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.safeArea}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <AppIcon name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          {chat ? (
            <>
              <Avatar uri={safeOtherUser.profileImage} name={safeOtherUser.displayName} size={36} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {safeOtherUser.displayName || safeOtherUser.username || 'Chat'}
                </Text>
                <Text style={styles.headerHandle}>@{safeOtherUser.username}</Text>
              </View>
            </>
          ) : (
            <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 10 }} />
          )}

          {/* More menu */}
          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => setShowMenu(!showMenu)}
              activeOpacity={0.7}
            >
              <AppIcon name="more-horiz" size={20} color={colors.text} />
            </TouchableOpacity>

            {showMenu && (
              <>
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  onPress={() => setShowMenu(false)}
                  activeOpacity={1}
                />
                <View style={styles.dropdownMenu}>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setShowMenu(false);
                      setShowNuclearConfirm(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.nuclearIconText}>Nuclear Block</Text>
                    <Text style={styles.menuItemTextDelete}>Nuclear Block</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Messages + Input */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            style={{ flex: 1 }}
            data={messages || []}
            keyExtractor={(item, index) => item.id || `msg-fallback-${index}`}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 16, gap: 4, paddingTop: 8 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 80 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No messages yet. Say hello!</Text>
              </View>
            }
            onContentSizeChange={() => {
              try { flatRef.current?.scrollToEnd({ animated: false }); } catch {}
            }}
            ListFooterComponent={<View style={{ height: 80 }} />}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Reply preview */}
        {replyTo && (
          <View style={styles.replyPreview}>
            <View style={styles.replyPreviewLine} />
            <View style={styles.replyPreviewContent}>
              <Text style={styles.replyPreviewName}>
                {replyTo.senderId === currentUser?.uid ? 'You' : (chat?.otherUser?.displayName || 'User')}
              </Text>
              <Text style={styles.replyPreviewText} numberOfLines={1}>
                {replyTo.content || (replyTo.messageType === 'voice' ? 'Voice message' : replyTo.messageType === 'image' ? 'Photo' : 'GIF')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
              <AppIcon name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <TouchableOpacity
            style={styles.inputActionBtn}
            onPress={() => setShowAttachMenu(!showAttachMenu)}
            activeOpacity={0.6}
          >
            <AppIcon name="add-circle-outline" size="lg" color={showAttachMenu ? colors.accent : colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.inputPill}>
            <TextInput
              style={styles.pillInput}
              placeholder="Start a message"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
              onFocus={() => setShowAttachMenu(false)}
            />
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, (text.trim() || sending) && styles.sendBtnActive]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
            activeOpacity={0.7}
          >
            {sending || uploading
              ? <ActivityIndicator color={colors.accent} size="small" />
              : <AppIcon name="send" size="md" color={text.trim() ? colors.white : colors.border} />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Attachment menu */}
      {showAttachMenu && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            onPress={() => setShowAttachMenu(false)}
            activeOpacity={1}
          />
          <View style={styles.attachMenu}>
            <TouchableOpacity style={styles.attachItem} onPress={handlePickImage} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
                <AppIcon name="image" size="lg" color="#3B82F6" />
              </View>
              <Text style={styles.attachLabel}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleCamera} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
                <AppIcon name="camera-alt" size="lg" color={colors.accentGreen} />
              </View>
              <Text style={styles.attachLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleOpenGifPicker} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                <AppIcon name="movie" size="lg" color="#A855F7" />
              </View>
              <Text style={styles.attachLabel}>GIF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleStartVoiceRecord} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                <AppIcon name="mic" size="lg" color={colors.error} />
              </View>
              <Text style={styles.attachLabel}>Voice</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Uploading overlay */}
      {uploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.uploadingText}>Sending photo...</Text>
        </View>
      )}

      {/* Nuclear Block Modal */}
      <Modal visible={showNuclearConfirm} transparent animationType="fade" onRequestClose={() => setShowNuclearConfirm(false)}>
        <View style={styles.nuclearOverlay}>
          <View style={styles.nuclearDialog}>
            <View style={styles.nuclearIconContainer}>
              <AppIcon name="error-outline" size="hero" color={colors.like} />
            </View>
            <Text style={styles.nuclearTitle}>Nuclear Block</Text>
            <Text style={styles.nuclearMessage}>
              This will permanently delete ALL messages, media, and attachments for BOTH users. This cannot be undone.
            </Text>
            <Text style={styles.nuclearSubtitle}>
              The user will also be blocked from contacting you again.
            </Text>
            <View style={styles.nuclearActions}>
              <TouchableOpacity style={styles.nuclearCancelBtn} onPress={() => setShowNuclearConfirm(false)}>
                <Text style={styles.nuclearCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nuclearConfirmBtn} onPress={handleNuclearBlock} disabled={blocking}>
                {blocking ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.nuclearConfirmText}>Block Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Context Menu (React + Reply + Delete) */}
      <Modal visible={!!contextMsg} transparent animationType="fade" onRequestClose={() => setContextMsg(null)}>
        <TouchableOpacity style={styles.reactionModalOverlay} activeOpacity={1} onPress={() => setContextMsg(null)}>
          <View style={styles.contextMenu}>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setContextMsg(null);
                setReactionMsg(contextMsg!);
              }}
            >
              <AppIcon name="emoji-emotions" size={20} color={colors.text} />
              <Text style={styles.contextMenuText}>React</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                if (contextMsg) {
                  setReplyTo(contextMsg);
                  setContextMsg(null);
                }
              }}
            >
              <AppIcon name="reply" size={20} color={colors.text} />
              <Text style={styles.contextMenuText}>Reply</Text>
            </TouchableOpacity>
            {contextMsg?.senderId === currentUser?.uid && (
              <>
                <View style={styles.contextMenuDivider} />
                <TouchableOpacity
                  style={[styles.contextMenuItem, { opacity: 0.7 }]}
                  onPress={() => handleDeleteMessage('me')}
                >
                  <AppIcon name="delete-outline" size={20} color={colors.text} />
                  <Text style={styles.contextMenuText}>Delete for Me</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.contextMenuItem, { opacity: 0.9 }]}
                  onPress={() => {
                    Alert.alert(
                      'Delete for Everyone',
                      'This message will be deleted for all participants. This cannot be undone.',
                      [
                        { text: 'Cancel', style: 'cancel', onPress: () => setContextMsg(null) },
                        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteMessage('everyone') },
                      ],
                    );
                  }}
                >
                  <AppIcon name="delete" size={20} color={colors.like} />
                  <Text style={[styles.contextMenuText, { color: colors.like }]}>Delete for Everyone</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Emoji Reaction Picker */}
      <Modal visible={!!reactionMsg} transparent animationType="fade" onRequestClose={() => setReactionMsg(null)}>
        <TouchableOpacity style={styles.reactionModalOverlay} activeOpacity={1} onPress={() => setReactionMsg(null)}>
          <View style={styles.reactionPicker}>
            {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
              <TouchableOpacity key={emoji} style={styles.reactionEmojiBtn} onPress={() => handleReaction(emoji)}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen Image Viewer */}
      <Modal visible={!!fullscreenImage} transparent animationType="fade" onRequestClose={() => setFullscreenImage(null)}>
        <TouchableOpacity
          style={styles.imageViewerOverlay}
          activeOpacity={1}
          onPress={() => setFullscreenImage(null)}
        >
          <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {safeImageSource(fullscreenImage) ? (
              <Image
                source={safeImageSource(fullscreenImage)}
                style={styles.fullscreenImage}
                resizeMode="contain"
                onError={() => setFullscreenImage(null)}
              />
            ) : null}
            <TouchableOpacity style={styles.imageViewerClose} onPress={() => setFullscreenImage(null)} hitSlop={16}>
              <AppIcon name="close" size="xxl" color={colors.white} />
            </TouchableOpacity>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>

      {/* Recording Overlay */}
      {isRecording && (
        <View style={styles.recordingOverlay}>
          <View style={styles.recordingContent}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording...</Text>
            <Text style={styles.recordingDuration}>{recordingDuration}s</Text>
            <TouchableOpacity
              style={styles.recordingStopBtn}
              onPress={handleStopVoiceRecord}
              activeOpacity={0.7}
            >
              <AppIcon name="stop-circle" size="hero" color={colors.like} />
            </TouchableOpacity>
            <Text style={styles.recordingHint}>Tap to stop</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 0,
    backgroundColor: colors.overlayFull,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  headerName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  headerHandle: { color: colors.textSecondary, fontSize: 12 },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 180,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.primaryForeground,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 50,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  nuclearIconText: { fontSize: 20 },
  menuItemTextDelete: {
    color: colors.like,
    fontSize: 14,
    fontWeight: '500',
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowRight: { justifyContent: 'flex-end' },
  msgRowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: {
    backgroundColor: 'transparent',
  },
  bubbleTheirs: {
    backgroundColor: 'transparent',
  },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 22 },
  minimalText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTime: { fontSize: 10, marginTop: 2, marginRight: 2, color: colors.textSecondary, opacity: 0.5 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.borderSubtleAlt,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  reactionText: { fontSize: 14 },
  reactionModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: colors.avatarFallback,
    borderRadius: 24,
    padding: 8,
    gap: 4,
    shadowColor: colors.primaryForeground,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  reactionEmojiBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionEmoji: { fontSize: 28 },
  contextMenu: {
    backgroundColor: colors.avatarFallback,
    borderRadius: 16,
    paddingVertical: 8,
    width: 220,
    shadowColor: colors.primaryForeground,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contextMenuText: {
    fontSize: 15,
    color: colors.text,
  },
  contextMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.accentBg,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  deletedBubble: {
    opacity: 0.4,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: colors.overlaySolid,
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.borderSubtleStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubbleImage: {
    width: '100%',
    maxWidth: 240,
    aspectRatio: 1,
    borderRadius: 16,
    marginBottom: 2,
  },
  bubbleGif: {
    width: '100%',
    maxWidth: 220,
    aspectRatio: 5 / 4,
    borderRadius: 14,
    marginBottom: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 0,
  },
  inputActionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 4,
    maxHeight: 120,
  },
  pillInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: colors.white,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 4,
    maxHeight: 100,
    minHeight: 0,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnActive: {
    backgroundColor: colors.accent,
  },
  attachMenu: {
    position: 'absolute',
    bottom: 60,
    left: 14,
    flexDirection: 'row',
    gap: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    shadowColor: colors.primaryForeground,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
    zIndex: 60,
  },
  attachItem: {
    alignItems: 'center',
    gap: 6,
  },
  attachIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '500',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 100,
  },
  uploadingText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  nuclearOverlay: {
    flex: 1,
    backgroundColor: colors.overlayHeavy,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  nuclearDialog: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
  },
  nuclearIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(244,63,94,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  nuclearTitle: {
    color: colors.like,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  nuclearMessage: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  nuclearSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  nuclearActions: {
    flexDirection: 'row',
    gap: 12,
  },
  nuclearCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtleStrong,
    alignItems: 'center',
  },
  nuclearCancelText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  nuclearConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.like,
    alignItems: 'center',
  },
  nuclearConfirmText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  voiceBubbleWrap: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  voiceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  minimalTime: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.5,
    marginTop: 1,
    marginRight: 2,
  },
  voiceWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 28,
  },
  voiceBar: {
    width: 3,
    height: '100%',
    borderRadius: 2,
  },
  voiceDuration: {
    fontSize: 12,
    fontWeight: '500',
  },
  recordingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlayMax,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  recordingContent: {
    alignItems: 'center',
    gap: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.like,
  },
  recordingText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  recordingDuration: {
    color: colors.textSecondary,
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  recordingStopBtn: {
    marginTop: 12,
  },
  recordingHint: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 4,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    marginHorizontal: 10,
  },
  replyPreviewLine: {
    width: 2,
    height: '100%',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  replyPreviewContent: {
    flex: 1,
    marginLeft: 4,
    gap: 2,
  },
  replyPreviewName: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  replyPreviewText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  replyIndicator: {
    backgroundColor: colors.bgSubtle,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  replyIndicatorName: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  replyIndicatorText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
});
