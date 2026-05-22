import React from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, Modal } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Message } from '../lib/api';
import { auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { useChatRoom } from '../hooks/useChatRoom';

function formatTime(timestamp?: number | string): string {
  if (!timestamp) return '';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function ChatRoomScreen({ route, navigation }: any) {
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

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === currentUser?.uid;
    const msgType = item.messageType || 'text';
    const myReaction = item.reactions?.[currentUser?.uid || ''] || null;
    const reactionEntries = item.reactions ? Object.values(item.reactions) as string[] : [];

    // Deleted message placeholder
    if (item.deleted) {
      return (
        <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
          {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, styles.deletedBubble]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ban-outline" size={14} color={isMine ? 'rgba(0,0,0,0.35)' : '#4a5568'} />
              <Text style={[styles.bubbleText, isMine ? { color: 'rgba(0,0,0,0.35)' } : { color: '#4a5568' }, { fontStyle: 'italic' }]}>
                This message was deleted
              </Text>
            </View>
            <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.3)' } : { color: '#4a5568' }]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
        {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
        <TouchableOpacity
          onLongPress={() => {
            if (isMine) {
              setContextMsg(item);
            } else {
              setReactionMsg(item);
            }
          }}
          onPress={() => {
            if (msgType === 'text') setReplyTo(item);
          }}
          activeOpacity={1}
          style={{ maxWidth: '80%' }}
        >
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {/* Image message */}
          {msgType === 'image' && item.mediaUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setFullscreenImage(item.mediaUrl)}
            >
              <Image
                source={{ uri: item.mediaUrl }}
                style={styles.bubbleImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : null}

          {/* GIF message */}
          {msgType === 'gif' && item.mediaUrl ? (
            <Image
              source={{ uri: item.mediaUrl }}
              style={styles.bubbleGif}
              resizeMode="contain"
            />
          ) : null}

          {/* Voice message */}
          {msgType === 'voice' && (
            <TouchableOpacity
              style={styles.voiceBubble}
              onPress={() => handlePlayVoice(item)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={playingVoiceId === item.id ? 'pause-circle' : 'play-circle'}
                size={36}
                color={isMine ? '#000000' : '#e7e9ea'}
              />
              <View style={styles.voiceWaveform}>
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.3)' } : { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.5)' } : { backgroundColor: 'rgba(255,255,255,0.5)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.3)' } : { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.6)' } : { backgroundColor: 'rgba(255,255,255,0.6)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.2)' } : { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              </View>
              <Text style={[styles.voiceDuration, isMine ? { color: 'rgba(0,0,0,0.6)' } : { color: '#94a3b8' }]}>
                {item.voiceDuration || 0}s
              </Text>
            </TouchableOpacity>
          )}

          {/* Text content (for text messages or captions) */}
          {item.content && msgType === 'text' ? (
            <Text style={[styles.bubbleText, isMine && { color: '#000000' }]}>{item.content}</Text>
          ) : null}

          {/* Timestamp */}
          <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.5)' } : { color: '#94a3b8' }]}>
            {formatTime(item.createdAt)}
          </Text>
          {/* Read receipt indicators — own messages only */}
          {isMine && (
            <View style={styles.receiptRow}>
              {item.status === 'read' ? (
                <Ionicons name="checkmark-done" size={14} color="#38bdf8" />
              ) : item.status === 'delivered' ? (
                <Ionicons name="checkmark-done" size={14} color="rgba(0,0,0,0.3)" />
              ) : (
                <Ionicons name="checkmark" size={14} color="rgba(0,0,0,0.3)" />
              )}
            </View>
          )}
          {/* Reactions display */}
          {reactionEntries.length > 0 && (
            <View style={styles.reactionBadge}>
              <Text style={styles.reactionText}>{reactionEntries.join('')}</Text>
            </View>
          )}
          {/* Reply indicator */}
          {item.replyToContent && (
            <View style={styles.replyIndicator}>
              <Text style={styles.replyIndicatorName}>{item.replyToSenderName || 'Reply'}</Text>
              <Text style={styles.replyIndicatorText} numberOfLines={1}>{item.replyToContent}</Text>
            </View>
          )}
        </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (!chat) {
    return (
      <View style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.safeArea]}>
      {/* Header with SafeAreaView for notch */}
      <SafeAreaView edges={['top']}>
      <View style={[styles.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#e7e9ea" />
        </TouchableOpacity>
        {chat ? (
          <>
            <Avatar uri={chat.otherUser?.profileImage} name={chat.otherUser?.displayName} size={36} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.headerName} numberOfLines={1}>
                {chat.otherUser?.displayName || chat.otherUser?.username || 'Chat'}
              </Text>
              <Text style={styles.headerHandle}>@{chat.otherUser?.username}</Text>
            </View>
          </>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 10 }} />
        )}

        {/* Call button — hidden until VoIP SDK integration is complete */}

        {/* More menu button */}
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => setShowMenu(!showMenu)}
            activeOpacity={0.7}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#e7e9ea" />
          </TouchableOpacity>

          {/* Dropdown menu */}
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
                  <Text style={styles.nuclearIcon}>💣</Text>
                  <Text style={styles.menuItemTextDelete}>Nuclear Block</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
      </SafeAreaView>

      {/* Messages + Input — wrapped in KAV so keyboard pushes input bar up */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Messages */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            style={{ flex: 1 }}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 16, gap: 4, paddingTop: 8 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 80 }}>
                <Text style={{ color: '#94a3b8', fontSize: 15 }}>No messages yet. Say hello!</Text>
              </View>
            }
            onContentSizeChange={() => {
              flatRef.current?.measure((_, __, ___, contentHeight) => {
                flatRef.current?.scrollToEnd({ animated: false });
              });
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
              <Ionicons name="close" size={16} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(8, insets.bottom) }]}>
          {/* Attachment button */}
          <TouchableOpacity
            style={styles.inputActionBtn}
            onPress={() => setShowAttachMenu(!showAttachMenu)}
            activeOpacity={0.6}
          >
            <Ionicons name="add-circle-outline" size={22} color={showAttachMenu ? colors.accent : '#71767b'} />
          </TouchableOpacity>

          <View style={styles.inputPill}>
            <TextInput
              style={styles.pillInput}
              placeholder="Start a message"
              placeholderTextColor="#71767b"
              value={text}
              onChangeText={setText}
              multiline
              onFocus={() => setShowAttachMenu(false)}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (text.trim() || sending) && styles.sendBtnActive,
            ]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
            activeOpacity={0.7}
          >
            {sending || uploading
              ? <ActivityIndicator color={colors.accent} size="small" />
              : <Ionicons name="send" size={18} color={text.trim() ? '#FFFFFF' : '#374151'} />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Attachment menu popup */}
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
                <Ionicons name="image-outline" size={22} color="#3B82F6" />
              </View>
              <Text style={styles.attachLabel}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleCamera} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
                <Ionicons name="camera-outline" size={22} color="#10B981" />
              </View>
              <Text style={styles.attachLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleOpenGifPicker} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                <Ionicons name="film-outline" size={22} color="#A855F7" />
              </View>
              <Text style={styles.attachLabel}>GIF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleStartVoiceRecord} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                <Ionicons name="mic-outline" size={22} color="#EF4444" />
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

      {/* Nuclear Block Confirmation Modal */}
      <Modal
        visible={showNuclearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNuclearConfirm(false)}
      >
        <View style={styles.nuclearOverlay}>
          <View style={styles.nuclearDialog}>
            <View style={styles.nuclearIconContainer}>
              <Ionicons name="alert-circle" size={48} color="#f43f5e" />
            </View>
            <Text style={styles.nuclearTitle}>💣 Nuclear Block</Text>
            <Text style={styles.nuclearMessage}>
              This will permanently delete ALL messages, media, and attachments for BOTH users. This cannot be undone.
            </Text>
            <Text style={styles.nuclearSubtitle}>
              The user will also be blocked from contacting you again.
            </Text>
            <View style={styles.nuclearActions}>
              <TouchableOpacity
                style={styles.nuclearCancelBtn}
                onPress={() => setShowNuclearConfirm(false)}
              >
                <Text style={styles.nuclearCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nuclearConfirmBtn}
                onPress={handleNuclearBlock}
                disabled={blocking}
              >
                {blocking ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.nuclearConfirmText}>Block Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Message Context Menu (delete for me / everyone) — own messages only */}
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
              <Ionicons name="happy-outline" size={20} color="#e7e9ea" />
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
              <Ionicons name="return-down-left" size={20} color="#e7e9ea" />
              <Text style={styles.contextMenuText}>Reply</Text>
            </TouchableOpacity>
            <View style={styles.contextMenuDivider} />
            <TouchableOpacity
              style={[styles.contextMenuItem, { opacity: 0.7 }]}
              onPress={() => handleDeleteMessage('me')}
            >
              <Ionicons name="trash-outline" size={20} color="#e7e9ea" />
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
              <Ionicons name="trash" size={20} color="#f43f5e" />
              <Text style={[styles.contextMenuText, { color: '#f43f5e' }]}>Delete for Everyone</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Emoji Reaction Picker Modal */}
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

      {/* Full-screen image viewer */}
      <Modal visible={!!fullscreenImage} transparent animationType="fade" onRequestClose={() => setFullscreenImage(null)}>
        <TouchableOpacity
          style={styles.imageViewerOverlay}
          activeOpacity={1}
          onPress={() => setFullscreenImage(null)}
        >
          <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {fullscreenImage ? (
              <Image
                source={{ uri: fullscreenImage }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            ) : null}
            <TouchableOpacity style={styles.imageViewerClose} onPress={() => setFullscreenImage(null)} hitSlop={16}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>

      {/* Recording overlay */}
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
              <Ionicons name="stop-circle" size={48} color="#f43f5e" />
            </TouchableOpacity>
            <Text style={styles.recordingHint}>Tap to stop</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  headerName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  headerHandle: { color: '#94a3b8', fontSize: 12 },
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
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
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
  nuclearIcon: { fontSize: 20 },
  menuItemTextDelete: {
    color: '#f43f5e',
    fontSize: 14,
    fontWeight: '500',
  },
  // ── Messages ──
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowRight: { justifyContent: 'flex-end' },
  msgRowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: {
    backgroundColor: '#FFFFFF',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleText: { color: '#e7e9ea', fontSize: 14, lineHeight: 22 },
  bubbleTime: { fontSize: 11, marginTop: 4, marginRight: 2 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  reactionText: { fontSize: 14 },
  reactionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 8,
    gap: 4,
    shadowColor: '#000',
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
  // ── Context Menu (delete) ──
  contextMenu: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 8,
    width: 220,
    shadowColor: '#000',
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
    color: '#e7e9ea',
  },
  contextMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 12,
    marginVertical: 4,
  },
  deletedBubble: {
    opacity: 0.6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  // ── Full-screen image viewer ──
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
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
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ── Image in bubble ──
  bubbleImage: {
    width: 220,
    height: 220,
    borderRadius: 14,
    marginBottom: 4,
  },
  bubbleGif: {
    width: 200,
    height: 160,
    borderRadius: 14,
    marginBottom: 4,
  },
  // ── Input bar ──
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
    backgroundColor: '#16181c',
    borderRadius: 22,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 4,
    maxHeight: 120,
  },
  pillInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: '#FFFFFF',
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
  sendBtnInactive: {},
  // ── Attachment menu ──
  attachMenu: {
    position: 'absolute',
    bottom: 60,
    left: 14,
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#16181c',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
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
    color: '#e7e9ea',
    fontSize: 11,
    fontWeight: '500',
  },
  // ── Upload overlay ──
  uploadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 100,
  },
  uploadingText: {
    color: '#e7e9ea',
    fontSize: 14,
    fontWeight: '500',
  },
  // ── Nuclear block modal ──
  nuclearOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  nuclearDialog: {
    backgroundColor: '#16181c',
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
    color: '#f43f5e',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  nuclearMessage: {
    color: '#e7e9ea',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  nuclearSubtitle: {
    color: '#94a3b8',
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
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
  },
  nuclearCancelText: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '600',
  },
  nuclearConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
  },
  nuclearConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  // ── Voice message ──
  voiceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
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
  // ── Recording overlay ──
  recordingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
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
    backgroundColor: '#f43f5e',
  },
  recordingText: {
    color: '#e7e9ea',
    fontSize: 16,
    fontWeight: '600',
  },
  recordingDuration: {
    color: '#94a3b8',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  recordingStopBtn: {
    marginTop: 12,
  },
  recordingHint: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
  },
  // ── Reply preview ──
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
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
    color: '#94a3b8',
    fontSize: 13,
  },
  replyIndicator: {
    backgroundColor: 'rgba(255,255,255,0.04)',
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
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
});
