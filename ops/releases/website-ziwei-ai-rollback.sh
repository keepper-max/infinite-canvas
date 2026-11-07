set -eu
test "$(hostname)" = iZm5edijeycdxfyte4d9igZ
exec 9>/run/lock/shoumiren-website-news.lock
flock -n 9
b=/root/shoumiren-ziwei-site15
s=/etc/nginx/snippets/shoumiren-homepage.conf
cmp "$s" "$b/homepage.after"
cmp /etc/nginx/sites-available/shoumiren-live "$b/main.before"
install -m 644 /var/www/shoumiren-site/releases/20261107-site15-ziwei/news-current.js /var/www/shoumiren-site/releases/20261107-site14-ziwei/news-current.js
install -m 644 "$b/homepage.before" /etc/nginx/snippets/shoumiren-homepage.ziwei-ai-rollback
mv /etc/nginx/snippets/shoumiren-homepage.ziwei-ai-rollback "$s"
nginx -t
systemctl reload nginx
echo ZIWEI_AI_EDGE_ROLLBACK_OK
