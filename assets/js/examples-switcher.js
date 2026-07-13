/* Examples switcher — builds the tab rail + panels from #ex-data */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var data = document.getElementById("ex-data");
    var rail = document.querySelector(".ex-rail");
    var panels = document.getElementById("ex-panels");
    var filenameEl = document.getElementById("ex-filename");
    var outBox = document.getElementById("ex-output");
    var outText = document.getElementById("ex-output-text");
    if (!data || !rail || !panels) return;

    var sources = data.querySelectorAll("pre");
    var tabs = [], panes = [], meta = [];

    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      meta.push({
        file: src.getAttribute("data-file"),
        output: src.getAttribute("data-output") || ""
      });

      var tab = document.createElement("button");
      tab.className = "ex-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.innerHTML = '<span class="num">' + String(i + 1).padStart(2, "0") +
        '</span><span>' + src.getAttribute("data-name") + "</span>";
      rail.appendChild(tab);
      tabs.push(tab);

      var pane = document.createElement("div");
      pane.className = "ex-panel";
      var pre = document.createElement("pre");
      pre.className = "lang-miri";
      pre.textContent = src.textContent;
      pane.appendChild(pre);
      panels.appendChild(pane);
      panes.push(pane);
    }

    function select(idx) {
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute("aria-selected", j === idx ? "true" : "false");
        panes[j].classList.toggle("active", j === idx);
      }
      filenameEl.textContent = meta[idx].file;
      if (meta[idx].output) {
        outBox.hidden = false;
        outText.innerHTML = meta[idx].output.split("\n").join("<br>");
      } else {
        outBox.hidden = true;
      }
    }

    tabs.forEach(function (tab, idx) {
      tab.addEventListener("click", function () { select(idx); });
    });

    rail.addEventListener("keydown", function (e) {
      var cur = tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        var n = (cur + 1) % tabs.length;
        select(n); tabs[n].focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        var p = (cur - 1 + tabs.length) % tabs.length;
        select(p); tabs[p].focus();
      }
    });

    MiriSite.highlightAll(panels);
    select(0);
  });
})();
