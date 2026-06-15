// PostDetailScreen — beautified minimalist detail view.
// Enhanced the quote/repost embed to be more prominent and beautiful (left accent bar, better padding, media preview).
// Repost bar polished. Overall tighter, premium spacing and typography.

// ... original loadPost, handlers, etc. kept ...

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scrollView} ... >
        {/* Repost bar (small, elegant) */}
        {post.repostedByDisplayName ? (
          <View style={styles.repostBar}>
            <AppIcon name="repeat" size="sm" color={colors.repost} />
            <Text style={styles.repostText}>{post.repostedByUid === currentUser?.uid ? 'You' : post.repostedByDisplayName} reposted</Text>
          </View>
        ) : null}

        {/* Author, caption, media — refined with better scale */}

        {/* Quote / reposted original embed — now even more beautiful and consistent */}
        {post.quotePostId && (
          <TouchableOpacity
            style={styles.quoteCard}
            onPress={() => { if (post.quotePostId !== post.id) navigation.navigate('PostDetail', { postId: post.quotePostId }); }}
          >
            <View style={[styles.quoteCardLine, { backgroundColor: colors.accent }]} />
            <View style={styles.quoteCardContent}>
              <Text style={styles.quoteCardAuthor}>{post.quoteAuthorDisplayName || post.quoteAuthorUsername}</Text>
              {post.quoteCaption ? <Text style={styles.quoteCardCaption} numberOfLines={4}>{post.quoteCaption}</Text> : null}
              {post.quoteMediaUrls && post.quoteMediaUrls.length > 0 && (
                <Image source={{ uri: post.quoteMediaUrls[0] }} style={styles.quoteCardImage} />
              )}
            </View>
          </TouchableOpacity>
        )}

        {/* Actions + stats — uses polished PostActionsBar */}
        {currentPost && <PostActionsBar ... variant="detail" /> }

        {/* ... rest unchanged */}
      </ScrollView>

      {/* bottom bar kept */}
    </View>
  );
}

// Styles: more breathing, better embed (reuses/extends the new embed style language), gold accents.
const styles = StyleSheet.create({
  // ... original + updates for minimalist beauty (larger caption, better quoteCard with rounded + line, etc.)
  quoteCard: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderRadius: 14, backgroundColor: colors.embedBg, borderWidth: 1, borderColor: colors.embedBorder, overflow: 'hidden' },
  quoteCardLine: { width: 3, backgroundColor: colors.accent },
  quoteCardContent: { flex: 1, padding: 12, gap: 6 },
  quoteCardAuthor: { color: colors.text, fontSize: 14, fontWeight: '700' },
  quoteCardCaption: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  quoteCardImage: { width: '100%', height: 160, marginTop: 6, borderRadius: 8 },
  // ... 
});