fn is_word_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

fn skip_comment(chars: &[char], i: usize) -> Option<usize> {
    if chars[i] == '-' && chars.get(i + 1) == Some(&'-') {
        let end = chars[i..].iter().position(|&c| c == '\n').map_or(chars.len(), |p| i + p);
        return Some(end);
    }
    if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
        let mut j = i + 2;
        while j + 1 < chars.len() && !(chars[j] == '*' && chars[j + 1] == '/') {
            j += 1;
        }
        return Some((j + 1).min(chars.len()));
    }
    None
}

fn skip_quoted(chars: &[char], i: usize, close: char, doubled: bool) -> usize {
    let mut j = i + 1;
    while j < chars.len() {
        if chars[j] == close {
            if doubled && chars.get(j + 1) == Some(&close) {
                j += 2;
                continue;
            }
            break;
        }
        j += 1;
    }
    j
}

pub fn split_sqlite(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = vec![];
    let mut start = 0;
    let mut depth = 0;
    let mut words: Vec<String> = vec![];
    let mut meaningful = false;
    let mut flush = |end: usize, start: &mut usize, depth: &mut i32, words: &mut Vec<String>, meaningful: &mut bool| {
        let stmt: String = chars[*start..end.min(chars.len())].iter().collect();
        let stmt = stmt.trim().to_string();
        if *meaningful && !stmt.is_empty() {
            out.push(stmt);
        }
        *start = end + 1;
        *depth = 0;
        words.clear();
        *meaningful = false;
    };
    let trigger = |w: &[String]| {
        w.first().map(String::as_str) == Some("CREATE")
            && (w.get(1).map(String::as_str) == Some("TRIGGER")
                || (matches!(w.get(1).map(String::as_str), Some("TEMP") | Some("TEMPORARY")) && w.get(2).map(String::as_str) == Some("TRIGGER")))
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(end) = skip_comment(&chars, i) {
            i = end;
        } else if matches!(c, '\'' | '"' | '`' | '[') {
            let close = if c == '[' { ']' } else { c };
            i = skip_quoted(&chars, i, close, close != ']');
            meaningful = true;
        } else if c == ';' {
            if depth == 0 {
                flush(i, &mut start, &mut depth, &mut words, &mut meaningful);
            }
        } else if is_word_start(c) {
            let mut j = i;
            while j + 1 < chars.len() && is_word(chars[j + 1]) {
                j += 1;
            }
            let word: String = chars[i..=j].iter().collect::<String>().to_uppercase();
            if words.len() < 3 {
                words.push(word.clone());
            }
            if trigger(&words) {
                if word == "BEGIN" || word == "CASE" {
                    depth += 1;
                } else if word == "END" && depth > 0 {
                    depth -= 1;
                }
            }
            meaningful = true;
            i = j;
        } else if !c.is_whitespace() {
            meaningful = true;
        }
        i += 1;
    }
    flush(chars.len(), &mut start, &mut depth, &mut words, &mut meaningful);
    out
}

pub fn split_batches(text: &str) -> Vec<String> {
    let mut out = vec![];
    let mut batch: Vec<&str> = vec![];
    for line in text.lines() {
        let t = line.trim();
        let t = t.split("--").next().unwrap_or("").trim();
        if t.eq_ignore_ascii_case("go") {
            out.push(batch.join("\n"));
            batch.clear();
        } else {
            batch.push(line);
        }
    }
    out.push(batch.join("\n"));
    out.into_iter().filter(|b| !b.trim().is_empty()).collect()
}

pub fn postgres_commands(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = vec![];
    let mut words: Vec<String> = vec![];
    let mut i = 0;
    let mut finish = |words: &mut Vec<String>| {
        if !words.is_empty() {
            out.push(command_of(words));
            words.clear();
        }
    };
    while i < chars.len() {
        let c = chars[i];
        if let Some(end) = skip_comment(&chars, i) {
            i = end;
        } else if c == '\'' || c == '"' {
            i = skip_quoted(&chars, i, c, true);
            if words.is_empty() {
                words.push(String::new());
            }
        } else if c == '$' {
            let mut j = i + 1;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            if chars.get(j) == Some(&'$') {
                let tag = &chars[i..=j];
                let mut k = j + 1;
                while k + tag.len() <= chars.len() && &chars[k..k + tag.len()] != tag {
                    k += 1;
                }
                i = (k + tag.len()).min(chars.len()) - 1;
            } else {
                i = j - 1;
            }
        } else if c == ';' {
            finish(&mut words);
        } else if is_word_start(c) {
            let mut j = i;
            while j + 1 < chars.len() && is_word(chars[j + 1]) {
                j += 1;
            }
            if words.len() < 3 {
                words.push(chars[i..=j].iter().collect::<String>().to_uppercase());
            }
            i = j;
        } else if !c.is_whitespace() && words.is_empty() {
            words.push(String::new());
        }
        i += 1;
    }
    finish(&mut words);
    out
}

fn command_of(words: &[String]) -> String {
    let first = words.first().map(String::as_str).unwrap_or("");
    match first {
        "CREATE" | "DROP" | "ALTER" => {
            let mut w: Vec<&str> = words.iter().map(String::as_str).take(3).collect();
            if !matches!(w.get(1), Some(&"OR") | Some(&"TEMP") | Some(&"TEMPORARY") | Some(&"UNIQUE") | Some(&"UNLOGGED")) {
                w.truncate(2);
            }
            w.join(" ")
        }
        "WITH" | "" => String::new(),
        _ => first.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_splits_on_semicolons_outside_strings_and_triggers() {
        let s = split_sqlite("select ';'; -- a; comment\ncreate trigger t after insert on x begin update y set a = case when 1 then 2 end; end; select 1;;");
        assert_eq!(s.len(), 3);
        assert!(s[1].contains("create trigger") && s[1].ends_with("end"));
    }

    #[test]
    fn batches_split_on_go() {
        assert_eq!(split_batches("select 1\nGO\nselect 2\n  go -- next\n"), ["select 1", "select 2"]);
    }

    #[test]
    fn postgres_commands_skip_strings_and_dollar_quotes() {
        let c = postgres_commands("insert into t values (';'); create table x (a int); do $$ begin; end $$; select 1");
        assert_eq!(c, ["INSERT", "CREATE TABLE", "DO", "SELECT"]);
    }
}
