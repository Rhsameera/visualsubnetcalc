FROM alpine:latest

RUN apk update \
    && apk add lighttpd \
    && rm -rf /var/cache/apk/*

COPY dist/ /var/www/localhost/htdocs

CMD ["lighttpd","-D","-f","/etc/lighttpd/lighttpd.conf"]
