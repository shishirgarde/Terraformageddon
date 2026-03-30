from pathlib import Path

path = Path('terraformageddon.html')
text = path.read_text(encoding='utf-8')

style_start = text.index('<style>')
style_end = text.index('</style>', style_start) + len('</style>')
css_content = text[style_start + len('<style>'):style_end - len('</style>')]

link_tag = '  <link rel= stylesheet href=css/style.css />\n'
new_text = text[:style_start] + link_tag + text[style_end:]

script_start = new_text.rindex('<script>')
script_end = new_text.index('</script>', script_start) + len('</script>')
script_content = new_text[script_start + len('<script>'):script_end - len('</script>')]

new_text = new_text[:script_start] + new_text[script_end:]
new_text = new_text.replace('</body>', '  <script src=js/app.js></script>\n</body>', 1)

Path('css').mkdir(exist_ok=True)
Path('js').mkdir(exist_ok=True)
Path('css/style.css').write_text(css_content.lstrip('\n'), encoding='utf-8')
Path('js/app.js').write_text(script_content.lstrip('\n'), encoding='utf-8')
path.write_text(new_text, encoding='utf-8')
