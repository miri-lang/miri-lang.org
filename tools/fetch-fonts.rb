#!/usr/bin/env ruby
# frozen_string_literal: true

# Download the site's two font families as woff2 for self-hosting, and emit the
# matching @font-face CSS. The fonts are served from this origin on purpose:
# loading them from fonts.googleapis.com transmits every visitor's IP to Google
# before any consent exists, which is what /datenschutz/ promises does not happen.
#
#   ruby tools/fetch-fonts.rb assets/fonts
#
# Writes the woff2 files plus a _fontface.css, whose contents belong at the top of
# assets/css/style.css. Two notes if you re-run this:
#   - Variable families return the SAME file for each requested weight. Dedupe and
#     collapse to one @font-face with a weight range.
#   - Only latin + latin-ext subsets are kept. unicode-range makes latin-ext lazy,
#     so it costs nothing at runtime.

require 'net/http'
require 'uri'
require 'fileutils'

DEST = ARGV[0] or abort 'usage: fetch-fonts.rb <fonts-dir>'
FileUtils.mkdir_p(DEST)

# Chrome UA is required — Google serves woff2 + variable fonts only to modern UAs.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' \
     '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

FAMILIES = {
  'space-grotesk' => 'Space+Grotesk:wght@400..700',
  'jetbrains-mono' => 'JetBrains+Mono:ital,wght@0,400..600;1,400'
}.freeze

KEEP_SUBSETS = %w[latin latin-ext].freeze

def get(url)
  uri = URI(url)
  req = Net::HTTP::Get.new(uri)
  req['User-Agent'] = UA
  res = Net::HTTP.start(uri.hostname, 443, use_ssl: true) { |h| h.request(req) }
  abort "GET #{url} -> #{res.code}" unless res.is_a?(Net::HTTPSuccess)
  res.body
end

blocks = []

FAMILIES.each do |slug, spec|
  css = get("https://fonts.googleapis.com/css2?family=#{spec}&display=swap")

  # Google emits `/* subset */` immediately before each @font-face block.
  css.scan(%r!/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})!m).each do |subset, block|
    next unless KEEP_SUBSETS.include?(subset)

    style = block[/font-style:\s*(\w+)/, 1] || 'normal'
    weight = block[/font-weight:\s*([\d\s]+)/, 1].to_s.strip
    url = block[/src:\s*url\(([^)]+)\)/, 1]
    next unless url

    ital = style == 'italic' ? 'i' : ''
    name = "#{slug}-#{weight.split.join('-')}#{ital}-#{subset}.woff2"
    File.binwrite(File.join(DEST, name), get(url))

    range = block[/unicode-range:\s*([^;]+);/, 1]
    family = block[/font-family:\s*'([^']+)'/, 1] || block[/font-family:\s*"([^"]+)"/, 1]

    blocks << {
      family: family, style: style, weight: weight, file: name,
      range: range&.strip, subset: subset, slug: slug
    }
    puts "  #{name} (#{File.size(File.join(DEST, name))} bytes)"
  end
end

css_out = +"/* ---------------------------------------------------------------\n"
css_out << "   Self-hosted webfonts.\n"
css_out << "   Served from this origin on purpose: loading these from\n"
css_out << "   fonts.googleapis.com transmits every visitor's IP to Google\n"
css_out << "   before any consent exists. /datenschutz/ states that this site\n"
css_out << "   makes no third-party requests — keep it that way.\n"
css_out << "   Regenerate with tools/fetch-fonts.rb.\n"
css_out << "   --------------------------------------------------------------- */\n\n"

blocks.each do |b|
  css_out << "@font-face {\n"
  css_out << "  font-family: '#{b[:family]}';\n"
  css_out << "  font-style: #{b[:style]};\n"
  css_out << "  font-weight: #{b[:weight]};\n"
  css_out << "  font-display: swap;\n"
  css_out << "  src: url('/assets/fonts/#{b[:file]}') format('woff2');\n"
  css_out << "  unicode-range: #{b[:range]};\n" if b[:range]
  css_out << "}\n\n"
end

File.write(File.join(DEST, '_fontface.css'), css_out)
puts "\n#{blocks.size} faces, #{blocks.map { |b| b[:slug] }.uniq.size} families"
puts "css -> #{File.join(DEST, '_fontface.css')}"
